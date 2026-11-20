# API Reference — `api-sentinel-express`

## 1. `createApiSentinel(options)`

Creates and returns a new frozen API Sentinel instance.

```javascript
import { createApiSentinel } from 'api-sentinel-express';

const sentinel = createApiSentinel({
  slowRequestThresholdMs: 500,
  maxRecentRequests: 200,
  maxRouteEntries: 100,
  windowSampleSize: 1000,
  requestIdHeader: 'X-Request-ID',
  trustIncomingRequestId: false,
  logging: {
    enabled: true,
    logSlowRequests: true,
    logServerErrors: true,
    logClientErrors: false,
    logAllRequests: false,
  },
  ignorePaths: ['/internal/metrics', /^\/healthz/],
});
```

### Configuration Options (`options`)

| Option | Type | Default | Valid Range / Constraints | Description |
| :--- | :--- | :--- | :--- | :--- |
| `slowRequestThresholdMs` | `number` | `500` | `1` – `3,600,000` | Duration threshold in milliseconds above which a request is flagged as slow (`isSlow: true`). |
| `maxRecentRequests` | `number` | `200` | Integer `1` – `50,000` | Capacity of the in-memory circular buffer storing recent request records. |
| `maxRouteEntries` | `number` | `100` | Integer `2` – `10,000` | Maximum distinct `(method + normalized route)` entries tracked before overflow aggregation. |
| `windowSampleSize` | `number` | `1000` | Integer `10` – `50,000` | Number of rolling latency samples retained for global and per-endpoint P95 calculations. |
| `requestIdHeader` | `string` | `'X-Request-ID'` | Valid HTTP token | Outgoing response header name where the request ID is set. |
| `trustIncomingRequestId` | `boolean` | `false` | `true` or `false` | When `true`, reuses an incoming request ID header if it matches `/^[A-Za-z0-9_-]{8,64}$/`. |
| `logging` | `boolean \| object` | `true` | `boolean` or `LoggerConfig` | Pass `false` to disable all logging, or a configuration object (see below). |
| `ignorePaths` | `Array<string\|RegExp> \| Function` | `[]` | Array or `(req) => boolean` | Excludes matching requests from monitoring and metrics collection. |
| `fallbackRouteLabel` | `string` | `'/ __overflow_routes__'` | Must start with `'/'` | Synthetic route template used when `maxRouteEntries` is reached. |
| `unmatchedRouteLabel` | `string` | `'/__unmatched__'` | Must start with `'/'` | Synthetic route template used for unmatched HTTP 404 responses. |

### `logging` Object Options

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `enabled` | `boolean` | `true` | Master switch for structured event emission. |
| `logSlowRequests` | `boolean` | `true` | Emit a `'slow-request'` event whenever `durationMs > slowRequestThresholdMs`. |
| `logServerErrors` | `boolean` | `true` | Emit `'server-error'` and `'error-detected'` events on 5xx responses and error middleware hits. |
| `logClientErrors` | `boolean` | `false` | Emit a `'client-error'` event on 4xx responses. |
| `logAllRequests` | `boolean` | `false` | Emit a `'request-completed'` event on normal 2xx/3xx requests. |
| `writer` | `(event) => void` | `undefined` | Custom callback receiving the sanitized event object instead of writing JSON to `console`. |

---

## 2. Returned Instance Methods & Properties

### `sentinel.middleware`
Express middleware function `(req, res, next) => void`. Register near the top of your Express middleware stack before application routes:

```javascript
app.use(sentinel.middleware);
```

### `sentinel.errorHandler`
Express error-handling middleware `(err, req, res, next) => void`. Register after all routes and before your final error responder:

```javascript
app.use(sentinel.errorHandler);
```

### `sentinel.getMetrics()`
Returns a detached, deeply cloned point-in-time snapshot object containing global counters, status distribution, latency summary, and per-endpoint analytics. Mutating the returned object never affects internal collector state.

### `sentinel.getRecentRequests(limit?)`
- `limit` (`number`, optional): Maximum number of recent request records to return.
- Returns an array of cloned request records ordered from **newest to oldest**.

### `sentinel.getEndpointMetrics()`
Returns a detached array of per-endpoint analytics objects sorted by descending request count.

### `sentinel.resetMetrics()`
Resets all counters, endpoint analytics, rolling latency buffers, and recent request records back to zero-state, and updates `startedAt` to the current timestamp.

### `sentinel.getConfig()`
Returns the frozen, validated configuration object active on this instance.
