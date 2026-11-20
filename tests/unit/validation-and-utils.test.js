import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CONFIG,
  extractSafeErrorMetadata,
  generateRequestId,
  isValidIncomingRequestId,
  resolveAndValidateConfig,
  resolveRequestId,
  sanitizeLogEvent,
} from '../../src/index.js';
import { StructuredLogger } from '../../src/utils/logger.js';

describe('Configuration Validation (validation.js)', () => {
  it('applies all default configuration values when called with no arguments', () => {
    const config = resolveAndValidateConfig();
    expect(config.slowRequestThresholdMs).toBe(DEFAULT_CONFIG.slowRequestThresholdMs);
    expect(config.maxRecentRequests).toBe(DEFAULT_CONFIG.maxRecentRequests);
    expect(config.maxRouteEntries).toBe(DEFAULT_CONFIG.maxRouteEntries);
    expect(config.windowSampleSize).toBe(DEFAULT_CONFIG.windowSampleSize);
    expect(config.requestIdHeader).toBe('X-Request-ID');
    expect(config.trustIncomingRequestId).toBe(false);
    expect(config.logging.enabled).toBe(true);
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('rejects non-object configuration inputs', () => {
    expect(() => resolveAndValidateConfig(null)).toThrow(TypeError);
    expect(() => resolveAndValidateConfig([])).toThrow(TypeError);
    expect(() => resolveAndValidateConfig('invalid')).toThrow(TypeError);
  });

  it('validates numeric bounds and integer constraints', () => {
    expect(() => resolveAndValidateConfig({ slowRequestThresholdMs: 0 })).toThrow(RangeError);
    expect(() => resolveAndValidateConfig({ slowRequestThresholdMs: -100 })).toThrow(RangeError);
    expect(() => resolveAndValidateConfig({ slowRequestThresholdMs: Number.NaN })).toThrow(
      TypeError
    );
    expect(() => resolveAndValidateConfig({ maxRecentRequests: 0 })).toThrow(RangeError);
    expect(() => resolveAndValidateConfig({ maxRecentRequests: 15.5 })).toThrow(RangeError);
    expect(() => resolveAndValidateConfig({ maxRouteEntries: 1 })).toThrow(RangeError);
    expect(() => resolveAndValidateConfig({ windowSampleSize: 5 })).toThrow(RangeError);
  });

  it('validates requestIdHeader, trustIncomingRequestId, ignorePaths, and route labels', () => {
    expect(() => resolveAndValidateConfig({ requestIdHeader: '' })).toThrow(TypeError);
    expect(() => resolveAndValidateConfig({ requestIdHeader: 'Bad Header\r\n' })).toThrow(
      TypeError
    );
    expect(() => resolveAndValidateConfig({ trustIncomingRequestId: 'yes' })).toThrow(TypeError);
    expect(() => resolveAndValidateConfig({ ignorePaths: 'not-an-array' })).toThrow(TypeError);
    expect(() => resolveAndValidateConfig({ ignorePaths: [123] })).toThrow(TypeError);
    expect(() => resolveAndValidateConfig({ fallbackRouteLabel: 'no-leading-slash' })).toThrow(
      TypeError
    );
    expect(() => resolveAndValidateConfig({ unmatchedRouteLabel: '' })).toThrow(TypeError);
  });

  it('validates logging options and custom writer callback', () => {
    const disabled = resolveAndValidateConfig({ logging: false });
    expect(disabled.logging.enabled).toBe(false);

    const writer = vi.fn();
    const custom = resolveAndValidateConfig({
      logging: {
        enabled: true,
        logAllRequests: true,
        logClientErrors: true,
        writer,
      },
    });
    expect(custom.logging.logAllRequests).toBe(true);
    expect(custom.logging.logClientErrors).toBe(true);
    expect(custom.logging.writer).toBe(writer);

    expect(() => resolveAndValidateConfig({ logging: 'invalid' })).toThrow(TypeError);
    expect(() => resolveAndValidateConfig({ logging: { writer: 'not-fn' } })).toThrow(TypeError);
    expect(() => resolveAndValidateConfig({ logging: { enabled: 'yes' } })).toThrow(TypeError);
  });
});

describe('Request ID Generation & Correlation Security (request-id.js)', () => {
  it('generates unique UUID v4 identifiers across 1,000 invocations', () => {
    const ids = new Set();
    for (let i = 0; i < 1000; i += 1) {
      const id = generateRequestId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      ids.add(id);
    }
    expect(ids.size).toBe(1000);
  });

  it('does not trust incoming request ID headers by default', () => {
    const fakeReq = {
      headers: {
        'x-request-id': 'external-id-12345678',
      },
    };
    const resolved = resolveRequestId(fakeReq, 'X-Request-ID', false);
    expect(resolved).not.toBe('external-id-12345678');
  });

  it('accepts incoming request ID only when trustIncoming is true AND format is strictly valid', () => {
    const validReq = {
      headers: {
        'x-request-id': 'trace_abc123456789',
      },
    };
    expect(resolveRequestId(validReq, 'X-Request-ID', true)).toBe('trace_abc123456789');

    const arrayHeaderReq = {
      headers: {
        'x-request-id': ['trace_array_123456', 'second_id'],
      },
    };
    expect(resolveRequestId(arrayHeaderReq, 'X-Request-ID', true)).toBe('trace_array_123456');

    const maliciousReq = {
      headers: {
        'x-request-id': 'bad\r\nSet-Cookie: session=hacked',
      },
    };
    const fallbackId = resolveRequestId(maliciousReq, 'X-Request-ID', true);
    expect(fallbackId).not.toContain('Set-Cookie');
    expect(isValidIncomingRequestId('short')).toBe(false);
    expect(isValidIncomingRequestId('a'.repeat(70))).toBe(false);
  });
});

describe('Privacy Sanitizer & Structured Logger (sanitizer.js & logger.js)', () => {
  it('strips non-whitelisted fields such as body, headers, cookies, tokens, and stack traces', () => {
    const dirtyEvent = {
      type: 'slow-request',
      requestId: 'req-12345678',
      method: 'post',
      route: '/api/login',
      statusCode: 200,
      durationMs: 612.4,
      timestamp: '2026-11-18T10:00:00.000Z',
      outcome: 'success',
      isSlow: true,
      isUnmatchedRoute: false,
      aborted: false,
      errorName: 'DatabaseError',
      errorCode: 'ER_LOCK_WAIT_TIMEOUT',
      password: 'super-secret-password',
      authorization: 'Bearer eyJhbGciOi...',
      cookie: 'connect.sid=s%3Asecret',
      body: { creditCard: '4111-1111-1111-1111' },
      stack: 'Error: secret at /app/src/db.js:42:11',
    };

    const clean = sanitizeLogEvent(dirtyEvent);
    expect(clean).toEqual({
      type: 'slow-request',
      requestId: 'req-12345678',
      method: 'POST',
      route: '/api/login',
      statusCode: 200,
      durationMs: 612.4,
      timestamp: '2026-11-18T10:00:00.000Z',
      outcome: 'success',
      isSlow: true,
      isUnmatchedRoute: false,
      aborted: false,
      errorName: 'DatabaseError',
      errorCode: 'ER_LOCK_WAIT_TIMEOUT',
    });
    expect('password' in clean).toBe(false);
    expect('authorization' in clean).toBe(false);
    expect('cookie' in clean).toBe(false);
    expect('body' in clean).toBe(false);
    expect('stack' in clean).toBe(false);
  });

  it('extracts safe error metadata without leaking sensitive error messages or stack traces', () => {
    const dbErr = new Error('Connection failed for user admin with password=topsecret');
    dbErr.name = 'SequelizeConnectionError';
    dbErr.code = 'ECONNRESET';

    const meta = extractSafeErrorMetadata(dbErr);
    expect(meta).toEqual({
      errorName: 'SequelizeConnectionError',
      errorCode: 'ECONNRESET',
    });
    expect(JSON.stringify(meta)).not.toContain('topsecret');

    expect(extractSafeErrorMetadata(null)).toEqual({ errorName: 'UnknownError' });
    expect(extractSafeErrorMetadata('raw string error')).toEqual({ errorName: 'NonObjectThrown' });

    const unsafeNameErr = { name: 'Error with spaces & secrets!', code: 500 };
    expect(extractSafeErrorMetadata(unsafeNameErr)).toEqual({
      errorName: 'ApplicationError',
      errorCode: '500',
    });
  });

  it('isolates logger failures so exceptions inside custom writers never crash the host app', () => {
    const throwingWriter = () => {
      throw new Error('Disk full or stream closed');
    };

    const logger = new StructuredLogger({
      enabled: true,
      logAllRequests: true,
      logSlowRequests: true,
      logServerErrors: true,
      logClientErrors: true,
      writer: throwingWriter,
    });

    expect(() =>
      logger.logCompletedRequest({
        requestId: 'req-1',
        method: 'GET',
        route: '/api/users',
        statusCode: 500,
        durationMs: 750,
        timestamp: new Date().toISOString(),
        isSlow: true,
      })
    ).not.toThrow();
  });

  it('routes default structured JSON output to console.info, console.warn, and console.error', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const logger = new StructuredLogger({
      enabled: true,
      logAllRequests: true,
      logSlowRequests: true,
      logServerErrors: true,
      logClientErrors: true,
    });

    logger.logCompletedRequest({
      requestId: 'req-ok',
      method: 'GET',
      route: '/api/ok',
      statusCode: 200,
      durationMs: 12,
      timestamp: '2026-11-18T10:00:00.000Z',
      isSlow: false,
    });
    expect(infoSpy).toHaveBeenCalledTimes(1);

    logger.logCompletedRequest({
      requestId: 'req-client-err',
      method: 'POST',
      route: '/api/items',
      statusCode: 422,
      durationMs: 15,
      timestamp: '2026-11-18T10:00:00.000Z',
      isSlow: false,
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);

    logger.logCompletedRequest({
      requestId: 'req-server-err',
      method: 'GET',
      route: '/api/crash',
      statusCode: 500,
      durationMs: 25,
      timestamp: '2026-11-18T10:00:00.000Z',
      isSlow: false,
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);

    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
