import {
  calculateElapsedDurationMs,
  classifyHttpStatus,
  startRequestTracking,
} from '../core/request-tracker.js';
import { cleanPathString, resolveNormalizedRoute } from '../core/route-normalizer.js';
import { resolveRequestId } from '../utils/request-id.js';

/**
 * Checks whether an incoming request matches any configured `ignorePaths` rule.
 *
 * @param {object} req - Express request object.
 * @param {Array<string|RegExp>|Function} ignorePaths - Ignore rules.
 * @returns {boolean} True if the request should be skipped by API Sentinel.
 */
export function shouldIgnoreRequest(req, ignorePaths) {
  if (typeof ignorePaths === 'function') {
    return Boolean(ignorePaths(req));
  }

  if (!Array.isArray(ignorePaths) || ignorePaths.length === 0) {
    return false;
  }

  const rawPath =
    (req && typeof req.originalUrl === 'string' && req.originalUrl) ||
    (req && typeof req.url === 'string' && req.url) ||
    (req && typeof req.path === 'string' && req.path) ||
    '/';
  const cleanedPath = cleanPathString(rawPath);

  for (const pattern of ignorePaths) {
    if (typeof pattern === 'string') {
      if (cleanPathString(pattern) === cleanedPath) {
        return true;
      }
    } else if (pattern instanceof RegExp) {
      if (pattern.test(cleanedPath)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Creates the primary API Sentinel Express middleware.
 *
 * @param {object} params - Internal dependencies.
 * @param {object} params.config - Resolved configuration.
 * @param {import('../core/metrics-collector.js').MetricsCollector} params.collector - Metrics collector instance.
 * @param {import('../utils/logger.js').StructuredLogger} params.logger - Structured logger instance.
 * @returns {Function} Express middleware function `(req, res, next) => void`.
 */
export function createSentinelMiddleware({ config, collector, logger }) {
  return function apiSentinelMiddleware(req, res, next) {
    if (shouldIgnoreRequest(req, config.ignorePaths)) {
      next();
      return;
    }

    const requestId = resolveRequestId(req, config.requestIdHeader, config.trustIncomingRequestId);
    const trackingContext = startRequestTracking(req, requestId);

    if (res && typeof res.setHeader === 'function' && !res.headersSent) {
      res.setHeader(config.requestIdHeader, requestId);
    }

    if (res && typeof res.locals === 'object' && res.locals !== null) {
      res.locals.requestId = requestId;
    }

    let finalized = false;

    const finalizeRequest = (aborted) => {
      if (finalized) {
        return;
      }
      finalized = true;

      if (res && typeof res.removeListener === 'function') {
        res.removeListener('finish', onFinish);
        res.removeListener('close', onClose);
      }

      const durationMs = calculateElapsedDurationMs(trackingContext.startTimeMs);
      const rawStatus =
        res && typeof res.statusCode === 'number' && Number.isFinite(res.statusCode)
          ? res.statusCode
          : 200;
      const statusCode = aborted && !res?.writableEnded && rawStatus === 200 ? 499 : rawStatus;

      const { route, isUnmatchedRoute } = resolveNormalizedRoute(
        req,
        statusCode,
        config.unmatchedRouteLabel
      );

      const method =
        req && typeof req.method === 'string' && req.method.trim().length > 0
          ? req.method.toUpperCase()
          : 'GET';

      const isSlow = durationMs > config.slowRequestThresholdMs;
      const outcome = classifyHttpStatus(statusCode);
      const timestamp = new Date().toISOString();

      const record = {
        requestId,
        timestamp,
        method,
        route,
        statusCode,
        durationMs,
        isSlow,
        outcome,
        isUnmatchedRoute,
        aborted,
      };

      if (trackingContext.errorName !== undefined) {
        record.errorName = trackingContext.errorName;
      }
      if (trackingContext.errorCode !== undefined) {
        record.errorCode = trackingContext.errorCode;
      }

      collector.recordRequest(record);
      logger.logCompletedRequest(record);
    };

    const onFinish = () => {
      finalizeRequest(false);
    };

    const onClose = () => {
      const wasAborted = !(res && (res.writableEnded || res.finished));
      finalizeRequest(wasAborted);
    };

    if (res && typeof res.on === 'function') {
      res.on('finish', onFinish);
      res.on('close', onClose);
    }

    next();
  };
}
