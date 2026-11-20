/**
 * Default configuration constants and validation bounds for API Sentinel.
 */
export const DEFAULT_CONFIG = Object.freeze({
  slowRequestThresholdMs: 500,
  maxRecentRequests: 200,
  maxRouteEntries: 100,
  windowSampleSize: 1000,
  requestIdHeader: 'X-Request-ID',
  trustIncomingRequestId: false,
  fallbackRouteLabel: '/__overflow_routes__',
  unmatchedRouteLabel: '/__unmatched__',
  logging: Object.freeze({
    enabled: true,
    logAllRequests: false,
    logSlowRequests: true,
    logServerErrors: true,
    logClientErrors: false,
  }),
});

export const CONFIG_BOUNDS = Object.freeze({
  slowRequestThresholdMs: { min: 1, max: 3_600_000 },
  maxRecentRequests: { min: 1, max: 50_000 },
  maxRouteEntries: { min: 2, max: 10_000 },
  windowSampleSize: { min: 10, max: 50_000 },
});
