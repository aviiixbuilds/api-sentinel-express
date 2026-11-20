import { calculateElapsedDurationMs, getRequestTrackingContext } from '../core/request-tracker.js';
import { resolveNormalizedRoute } from '../core/route-normalizer.js';
import { resolveRequestId } from '../utils/request-id.js';
import { extractSafeErrorMetadata } from '../utils/sanitizer.js';

/**
 * Creates the Express error-handling middleware for API Sentinel.
 *
 * Captures strictly sanitized error classification metadata (`errorName` and optional `errorCode`),
 * emits an `'error-detected'` structured log event, and always forwards the original error
 * to `next(err)` without swallowing exceptions or altering the response lifecycle.
 *
 * @param {object} params - Internal dependencies.
 * @param {object} params.config - Resolved configuration.
 * @param {import('../utils/logger.js').StructuredLogger} params.logger - Structured logger instance.
 * @returns {Function} Express error-handling middleware `(err, req, res, next) => void`.
 */
export function createSentinelErrorHandler({ config, logger }) {
  return function apiSentinelErrorHandler(err, req, res, next) {
    const safeMeta = extractSafeErrorMetadata(err);
    const trackingContext = getRequestTrackingContext(req);

    if (trackingContext) {
      trackingContext.errorName = safeMeta.errorName;
      if (safeMeta.errorCode !== undefined) {
        trackingContext.errorCode = safeMeta.errorCode;
      }
    }

    const requestId =
      trackingContext?.requestId ??
      resolveRequestId(req, config.requestIdHeader, config.trustIncomingRequestId);

    const durationMs = trackingContext
      ? calculateElapsedDurationMs(trackingContext.startTimeMs)
      : 0;

    const currentStatus =
      res && typeof res.statusCode === 'number' && res.statusCode >= 400 ? res.statusCode : 500;

    const { route, isUnmatchedRoute } = resolveNormalizedRoute(
      req,
      currentStatus,
      config.unmatchedRouteLabel
    );

    const method =
      req && typeof req.method === 'string' && req.method.trim().length > 0
        ? req.method.toUpperCase()
        : 'GET';

    if (config.logging.enabled && config.logging.logServerErrors) {
      logger.emit({
        type: 'error-detected',
        requestId,
        method,
        route,
        statusCode: currentStatus,
        durationMs,
        timestamp: new Date().toISOString(),
        outcome: currentStatus >= 500 ? 'server_error' : 'client_error',
        isSlow: durationMs > config.slowRequestThresholdMs,
        isUnmatchedRoute,
        errorName: safeMeta.errorName,
        ...(safeMeta.errorCode !== undefined ? { errorCode: safeMeta.errorCode } : {}),
      });
    }

    next(err);
  };
}
