import { describe, expect, it } from 'vitest';
import {
  calculatePercentile,
  cleanPathString,
  normalizeDynamicPathSegments,
  resolveAndValidateConfig,
  resolveNormalizedRoute,
  RollingWindowSampler,
  roundDuration,
} from '../../src/index.js';
import { MetricsCollector } from '../../src/core/metrics-collector.js';
import { classifyHttpStatus } from '../../src/core/request-tracker.js';

describe('Percentile & Rolling Window Calculations (percentile.js)', () => {
  it('returns 0 for empty samples or non-positive durations', () => {
    expect(roundDuration(-5)).toBe(0);
    expect(roundDuration(Number.NaN)).toBe(0);
    expect(calculatePercentile([])).toBe(0);
    expect(calculatePercentile([42.567])).toBe(42.57);
  });

  it('accurately computes nearest-rank P95 over known sample distributions', () => {
    const samples = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    expect(calculatePercentile(samples, 95)).toBe(95);
    expect(calculatePercentile(samples, 50)).toBe(50);
    expect(calculatePercentile(samples, 99)).toBe(99);
  });

  it('rejects out-of-range percentile arguments', () => {
    expect(() => calculatePercentile([10, 20], 0)).toThrow(RangeError);
    expect(() => calculatePercentile([10, 20], 101)).toThrow(RangeError);
    expect(() => new RollingWindowSampler(0)).toThrow(RangeError);
  });

  it('maintains bounded capacity and overwrites oldest entries in RollingWindowSampler', () => {
    const sampler = new RollingWindowSampler(10);
    expect(sampler.size()).toBe(0);
    expect(sampler.getPercentile(95)).toBe(0);

    // Insert 10 low values (10ms)
    for (let i = 0; i < 10; i += 1) {
      sampler.add(10);
    }
    expect(sampler.size()).toBe(10);
    expect(sampler.getPercentile(95)).toBe(10);

    // Overwrite all 10 entries with 500ms
    for (let i = 0; i < 10; i += 1) {
      sampler.add(500);
    }
    expect(sampler.size()).toBe(10);
    expect(sampler.getPercentile(95)).toBe(500);

    sampler.reset();
    expect(sampler.size()).toBe(0);
    expect(sampler.getPercentile(95)).toBe(0);
  });
});

describe('Route Normalization & High-Cardinality Prevention (route-normalizer.js)', () => {
  it('strips query parameters, hash fragments, and duplicate/trailing slashes', () => {
    expect(cleanPathString('/api/users/?token=secret123&page=2#section')).toBe('/api/users');
    expect(cleanPathString('//api///products//42//')).toBe('/api/products/42');
    expect(cleanPathString('')).toBe('/');
  });

  it('normalizes numeric IDs, UUIDs, MongoDB ObjectIds, and opaque tokens into :id', () => {
    expect(normalizeDynamicPathSegments('/api/users/98765/orders/123')).toBe(
      '/api/users/:id/orders/:id'
    );
    expect(normalizeDynamicPathSegments('/api/sessions/550e8400-e29b-41d4-a716-446655440000')).toBe(
      '/api/sessions/:id'
    );
    expect(normalizeDynamicPathSegments('/api/documents/507f1f77bcf86cd799439011')).toBe(
      '/api/documents/:id'
    );
    expect(normalizeDynamicPathSegments('/api/verify/tok_99a8b7c6d5e4f3g2h1')).toBe(
      '/api/verify/:id'
    );
  });

  it('prefers Express req.baseUrl + req.route.path and groups unmatched 404s', () => {
    const matchedReq = {
      baseUrl: '/api/v1/products',
      route: { path: '/:productId/reviews' },
      originalUrl: '/api/v1/products/42/reviews?rating=5',
    };
    expect(resolveNormalizedRoute(matchedReq, 200)).toEqual({
      route: '/api/v1/products/:productId/reviews',
      isUnmatchedRoute: false,
    });

    const unmatched404Req = {
      originalUrl: '/wp-admin/setup-config.php?exploit=1',
    };
    expect(resolveNormalizedRoute(unmatched404Req, 404)).toEqual({
      route: '/__unmatched__',
      isUnmatchedRoute: true,
    });
  });
});

describe('Bounded In-Memory MetricsCollector (metrics-collector.js)', () => {
  it('returns valid zero-state metrics before any traffic is observed', () => {
    const config = resolveAndValidateConfig();
    const collector = new MetricsCollector(config);
    const snapshot = collector.getMetrics();

    expect(snapshot.totalRequests).toBe(0);
    expect(snapshot.successfulRequests).toBe(0);
    expect(snapshot.clientErrorRequests).toBe(0);
    expect(snapshot.serverErrorRequests).toBe(0);
    expect(snapshot.notFoundRequests).toBe(0);
    expect(snapshot.unmatchedRouteRequests).toBe(0);
    expect(snapshot.slowRequests).toBe(0);
    expect(snapshot.abortedRequests).toBe(0);
    expect(snapshot.errorRate).toBe(0);
    expect(snapshot.slowRequestRate).toBe(0);
    expect(snapshot.latency).toEqual({
      avgMs: 0,
      minMs: 0,
      maxMs: 0,
      p95Ms: 0,
      sampleCount: 0,
    });
    expect(snapshot.endpoints).toEqual([]);
    expect(collector.getRecentRequests()).toEqual([]);
  });

  it('enforces maxRecentRequests ring-buffer capacity and newest-first ordering', () => {
    const config = resolveAndValidateConfig({ maxRecentRequests: 3 });
    const collector = new MetricsCollector(config);

    for (let i = 1; i <= 5; i += 1) {
      collector.recordRequest({
        requestId: `req-${i}`,
        timestamp: new Date().toISOString(),
        method: 'GET',
        route: '/api/items',
        statusCode: 200,
        durationMs: i * 10,
        isSlow: false,
        outcome: 'success',
        isUnmatchedRoute: false,
        aborted: false,
      });
    }

    const recent = collector.getRecentRequests();
    expect(recent.length).toBe(3);
    expect(recent.map((r) => r.requestId)).toEqual(['req-5', 'req-4', 'req-3']);

    expect(collector.getRecentRequests(2).map((r) => r.requestId)).toEqual(['req-5', 'req-4']);
    expect(collector.getRecentRequests(0)).toEqual([]);
    expect(() => collector.getRecentRequests('invalid')).toThrow(TypeError);
  });

  it('enforces maxRouteEntries and aggregates excess routes into the overflow bucket', () => {
    const config = resolveAndValidateConfig({
      maxRouteEntries: 3,
      fallbackRouteLabel: '/__overflow_routes__',
    });
    const collector = new MetricsCollector(config);

    // Record 3 distinct routes: all 3 fit within maxRouteEntries = 3
    for (const route of ['/api/r1', '/api/r2', '/api/r3']) {
      collector.recordRequest({
        requestId: `id-${route}`,
        timestamp: new Date().toISOString(),
        method: 'GET',
        route,
        statusCode: 200,
        durationMs: 15,
        isSlow: false,
        outcome: 'success',
        isUnmatchedRoute: false,
        aborted: false,
      });
    }

    let snapshot = collector.getMetrics();
    expect(snapshot.endpoints.length).toBe(3);
    expect(snapshot.cardinalityOverflowCount).toBe(0);

    // Record 4th and 5th unseen routes: triggers overflow bucket, total endpoints stays <= 3
    for (const route of ['/api/r4', '/api/r5']) {
      collector.recordRequest({
        requestId: `id-${route}`,
        timestamp: new Date().toISOString(),
        method: 'POST',
        route,
        statusCode: 500,
        durationMs: 120,
        isSlow: true,
        outcome: 'server_error',
        isUnmatchedRoute: false,
        aborted: false,
      });
    }

    snapshot = collector.getMetrics();
    expect(snapshot.endpoints.length).toBe(3);
    expect(snapshot.cardinalityOverflowCount).toBe(2);

    const overflowEntry = snapshot.endpoints.find((ep) => ep.isOverflowBucket);
    expect(overflowEntry).toBeDefined();
    expect(overflowEntry.route).toBe('/__overflow_routes__');
    expect(overflowEntry.requestCount).toBe(3); // 1 merged victim + 2 overflow requests
  });

  it('tracks 1xx, 2xx, 3xx (redirects vs 304 not_modified), 4xx (incl. 404), and 5xx without double counting', () => {
    expect(classifyHttpStatus(101)).toBe('informational');
    expect(classifyHttpStatus(200)).toBe('success');
    expect(classifyHttpStatus(301)).toBe('redirect');
    expect(classifyHttpStatus(302)).toBe('redirect');
    expect(classifyHttpStatus(307)).toBe('redirect');
    expect(classifyHttpStatus(308)).toBe('redirect');
    expect(classifyHttpStatus(304)).toBe('not_modified');
    expect(classifyHttpStatus(400)).toBe('client_error');
    expect(classifyHttpStatus(404)).toBe('client_error');
    expect(classifyHttpStatus(500)).toBe('server_error');

    const config = resolveAndValidateConfig();
    const collector = new MetricsCollector(config);

    const statusCodes = [100, 200, 201, 301, 302, 304, 304, 400, 404, 404, 429, 500, 503];
    for (const statusCode of statusCodes) {
      collector.recordRequest({
        requestId: `status-${statusCode}-${Math.random()}`,
        timestamp: new Date().toISOString(),
        method: 'GET',
        route: '/api/status-check',
        statusCode,
        durationMs: 5,
        isSlow: false,
        outcome: classifyHttpStatus(statusCode),
        isUnmatchedRoute: statusCode === 404,
        aborted: false,
      });
    }

    const metrics = collector.getMetrics();

    // Mutually exclusive statusDistribution families (no '404' key inside statusDistribution)
    expect(Object.keys(metrics.statusDistribution).sort()).toEqual([
      '1xx',
      '2xx',
      '3xx',
      '4xx',
      '5xx',
    ]);
    expect('404' in metrics.statusDistribution).toBe(false);

    expect(metrics.statusDistribution['1xx']).toBe(1);
    expect(metrics.statusDistribution['2xx']).toBe(2);
    expect(metrics.statusDistribution['3xx']).toBe(4); // two redirects (301, 302) + two 304s
    expect(metrics.statusDistribution['4xx']).toBe(4); // 400, 404, 404, 429
    expect(metrics.statusDistribution['5xx']).toBe(2); // 500, 503

    // Sum of the 5 status families must strictly equal totalRequests
    const familySum = Object.values(metrics.statusDistribution).reduce((acc, v) => acc + v, 0);
    expect(familySum).toBe(metrics.totalRequests);
    expect(metrics.totalRequests).toBe(statusCodes.length);

    // Separate redirect vs not_modified and supplementary notFoundRequests breakdown
    expect(metrics.informationalRequests).toBe(1);
    expect(metrics.successfulRequests).toBe(2);
    expect(metrics.redirectRequests).toBe(2);
    expect(metrics.notModifiedRequests).toBe(2);
    expect(metrics.clientErrorRequests).toBe(4);
    expect(metrics.notFoundRequests).toBe(2);
    expect(metrics.serverErrorRequests).toBe(2);

    // Endpoint-level reconciliation with requestCount
    const ep = metrics.endpoints[0];
    expect(ep.requestCount).toBe(statusCodes.length);
    expect(ep.informationalCount).toBe(1);
    expect(ep.successCount).toBe(2);
    expect(ep.redirectCount).toBe(2);
    expect(ep.notModifiedCount).toBe(2);
    expect(ep.clientErrorCount).toBe(4);
    expect(ep.serverErrorCount).toBe(2);
    expect(ep.errorCount).toBe(6);

    const endpointCategorySum =
      ep.informationalCount +
      ep.successCount +
      ep.redirectCount +
      ep.notModifiedCount +
      ep.clientErrorCount +
      ep.serverErrorCount;
    expect(endpointCategorySum).toBe(ep.requestCount);
  });
});
