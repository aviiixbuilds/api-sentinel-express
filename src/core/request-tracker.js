import { performance } from 'node:perf_hooks';
import { roundDuration } from './percentile.js';

/**
 * WeakMap associating an active Express Request object with its API Sentinel tracking context.
 * Using a WeakMap guarantees zero memory retention once the request lifecycle completes.
 */
const activeRequestContexts = new WeakMap();

/**
 * Initializes and attaches a tracking context to an incoming Express request.
 *
 * @param {object} req - Express request object.
 * @param {string} requestId - Unique request identifier.
 * @returns {object} Initialized request tracking context.
 */
export function startRequestTracking(req, requestId) {
  const context = {
    requestId,
    startTimeMs: performance.now(),
    errorName: undefined,
    errorCode: undefined,
  };
  if (req && typeof req === 'object') {
    activeRequestContexts.set(req, context);
  }
  return context;
}

/**
 * Retrieves the active tracking context for an Express request, if present.
 *
 * @param {object} req - Express request object.
 * @returns {object|undefined} Tracking context if found.
 */
export function getRequestTrackingContext(req) {
  if (!req || typeof req !== 'object') {
    return undefined;
  }
  return activeRequestContexts.get(req);
}

/**
 * Computes elapsed duration in milliseconds using `performance.now()`.
 *
 * @param {number} startTimeMs - Start timestamp from `performance.now()`.
 * @param {number} [endTimeMs=performance.now()] - End timestamp from `performance.now()`.
 * @returns {number} Elapsed duration in milliseconds rounded to 2 decimal places.
 */
export function calculateElapsedDurationMs(startTimeMs, endTimeMs = performance.now()) {
  const diffMs = endTimeMs - startTimeMs;
  if (!Number.isFinite(diffMs) || diffMs <= 0) {
    return 0;
  }
  return roundDuration(diffMs);
}

/**
 * Classifies an HTTP status code into a semantic outcome string.
 *
 * - 500–599: `'server_error'`
 * - 400–499: `'client_error'`
 * - 304: `'not_modified'` (cache validation response within 3xx family)
 * - 300–399 (excluding 304): `'redirect'`
 * - 200–299: `'success'`
 * - 100–199: `'informational'`
 *
 * @param {number} statusCode - HTTP response status code.
 * @returns {'success'|'redirect'|'not_modified'|'client_error'|'server_error'|'informational'} Outcome classification.
 */
export function classifyHttpStatus(statusCode) {
  if (statusCode >= 500) {
    return 'server_error';
  }
  if (statusCode >= 400) {
    return 'client_error';
  }
  if (statusCode === 304) {
    return 'not_modified';
  }
  if (statusCode >= 300) {
    return 'redirect';
  }
  if (statusCode >= 200) {
    return 'success';
  }
  return 'informational';
}
