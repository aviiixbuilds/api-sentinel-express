import { DEFAULT_CONFIG } from './config/defaults.js';
import { MetricsCollector } from './core/metrics-collector.js';
import { calculatePercentile, RollingWindowSampler, roundDuration } from './core/percentile.js';
import {
  cleanPathString,
  normalizeDynamicPathSegments,
  resolveNormalizedRoute,
} from './core/route-normalizer.js';
import { createSentinelMiddleware } from './middleware/create-middleware.js';
import { createSentinelErrorHandler } from './middleware/error-handler.js';
import { StructuredLogger } from './utils/logger.js';
import {
  generateRequestId,
  isValidIncomingRequestId,
  resolveRequestId,
} from './utils/request-id.js';
import { extractSafeErrorMetadata, sanitizeLogEvent } from './utils/sanitizer.js';
import { resolveAndValidateConfig } from './utils/validation.js';

/**
 * Creates a configured API Sentinel observability instance for an Express application.
 *
 * @param {object} [options={}] - Configuration options.
 * @param {number} [options.slowRequestThresholdMs=500] - Threshold in ms above which requests are marked slow.
 * @param {number} [options.maxRecentRequests=200] - Maximum recent request records stored in memory.
 * @param {number} [options.maxRouteEntries=100] - Maximum distinct route templates tracked before overflow bucket aggregation.
 * @param {number} [options.windowSampleSize=1000] - Rolling window sample capacity for P95 latency calculations.
 * @param {string} [options.requestIdHeader='X-Request-ID'] - Outgoing response header name for request IDs.
 * @param {boolean} [options.trustIncomingRequestId=false] - Whether to trust validated incoming request ID headers.
 * @param {boolean|object} [options.logging=true] - Enable/disable or customize structured logging.
 * @param {Array<string|RegExp>|Function} [options.ignorePaths=[]] - Paths or predicate to exclude from monitoring.
 * @param {string} [options.fallbackRouteLabel='/__overflow_routes__'] - Route label for cardinality overflow bucket.
 * @param {string} [options.unmatchedRouteLabel='/__unmatched__'] - Route label for unmatched 404 requests.
 * @returns {{
 *   middleware: Function,
 *   errorHandler: Function,
 *   getMetrics: () => object,
 *   getRecentRequests: (limit?: number) => object[],
 *   getEndpointMetrics: () => object[],
 *   resetMetrics: () => void,
 *   getConfig: () => object
 * }} Frozen API Sentinel instance.
 */
export function createApiSentinel(options = {}) {
  const config = resolveAndValidateConfig(options);
  const collector = new MetricsCollector(config);
  const logger = new StructuredLogger(config.logging);

  const middleware = createSentinelMiddleware({ config, collector, logger });
  const errorHandler = createSentinelErrorHandler({ config, logger });

  return Object.freeze({
    middleware,
    errorHandler,
    getMetrics: () => collector.getMetrics(),
    getRecentRequests: (limit) => collector.getRecentRequests(limit),
    getEndpointMetrics: () => collector.getEndpointMetrics(),
    resetMetrics: () => collector.reset(),
    getConfig: () => config,
  });
}

export {
  DEFAULT_CONFIG,
  calculatePercentile,
  RollingWindowSampler,
  roundDuration,
  cleanPathString,
  normalizeDynamicPathSegments,
  resolveNormalizedRoute,
  generateRequestId,
  isValidIncomingRequestId,
  resolveRequestId,
  extractSafeErrorMetadata,
  sanitizeLogEvent,
  resolveAndValidateConfig,
};

export default createApiSentinel;
