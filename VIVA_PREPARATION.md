# University Viva & Technical Defense Guide — API Sentinel (`api-sentinel-express`)

> Prepared for a Second-Year Computer Science Engineering (CSE) Student.
> Every explanation in this guide directly references the actual **plain JavaScript (`.js`)** implementation in this workspace.

---

## Part 1 — NPM Fundamentals

### 1. What is NPM?
**NPM (Node Package Manager)** consists of two things:
1. **The NPM Registry** (`https://registry.npmjs.org`): A public cloud database hosting millions of reusable JavaScript packages.
2. **The NPM CLI (`npm`)**: The command-line tool bundled with Node.js used to install dependencies, run project scripts, pack tarballs, and publish packages.

### 2. What is an NPM package, and how is it different from a web application?
- **A Web Application** (like our `api-sentinel-demo` project) is an end-user product that runs its own HTTP server (`app.listen(4000)`) and UI (`http://localhost:5173`).
- **An NPM Package** (like `api-sentinel-express`) is a **reusable library/SDK**. It does not start its own server; instead, it exports functions (`createApiSentinel`) that *other* applications import and run inside their own processes.

### 3. How does `package.json` work?
`package.json` is the manifest of our package. Its most important fields in `api-sentinel/package.json` are:
- `"name": "api-sentinel-express"` and `"version": "1.0.0"`: Uniquely identify the release on the NPM registry.
- `"type": "module"`: Tells Node.js that `.js` files in this project use modern ES Modules (`import`/`export`).
- `"main": "./dist/index.cjs"` and `"module": "./dist/index.js"`: Entry points for CommonJS (`require`) and ESM (`import`) consumers.
- `"exports"`: Modern Node.js conditional export map routing `import` to `./dist/index.js` and `require()` to `./dist/index.cjs`.
- `"files": ["dist", "README.md", "LICENSE", "CHANGELOG.md", "SECURITY.md"]`: Whitelist of files included when publishing to NPM.
- `"peerDependencies": { "express": "^4.18.0 || ^5.0.0" }`: Declares that the host application must provide Express.

### 4. What happens during `npm install`?
1. NPM reads `package.json` and `package-lock.json`.
2. It resolves the dependency tree and downloads compressed `.tgz` archives from `registry.npmjs.org` (or links a local folder when `"file:../../api-sentinel"` is used).
3. It extracts the packages into `node_modules/` and verifies integrity checksums in `package-lock.json`.

### 5. What happens during `npm publish` and `npm pack`?
- **`npm pack`**: Reads the `"files"` array in `package.json` and creates a compressed tarball (`api-sentinel-express-1.0.0.tgz`) containing only the production files (`dist/`, `README.md`, `LICENSE`, `CHANGELOG.md`, `SECURITY.md`, `package.json`).
- **`npm publish`**: Runs the `"prepublishOnly"` script (`npm run lint && npm run test && npm run build`), packs the tarball in memory, and uploads it via HTTPS to the NPM registry under your authenticated account.

### 6. What is a Peer Dependency?
Instead of placing `"express"` inside `"dependencies"`, we placed `"express": "^4.18.0 || ^5.0.0"` inside `"peerDependencies"`.
- **Why?** Because the developer installing `api-sentinel-express` already has Express installed in their backend. Marking Express as a peer dependency avoids downloading duplicate copies of Express and guarantees compatibility with both Express 4 and Express 5.

### 7. What are ESM and CommonJS?
- **CommonJS (CJS)**: Node.js's original module system using `const { createApiSentinel } = require('api-sentinel-express')` and `module.exports`.
- **ECMAScript Modules (ESM)**: The official JavaScript standard using `import { createApiSentinel } from 'api-sentinel-express'` and `export function ...`.
- Our build script (`scripts/build.js`) uses `esbuild` to compile our ESM source (`src/index.js`) into **both** `dist/index.js` (ESM) and `dist/index.cjs` (CommonJS), so any Node.js developer can use our package regardless of their module system.

### 8. What is Semantic Versioning (SemVer)?
Versions follow `MAJOR.MINOR.PATCH` (e.g., `1.0.0`):
- **MAJOR (`1.x.x`)**: Incompatible breaking API changes.
- **MINOR (`x.1.x`)**: New backward-compatible features.
- **PATCH (`x.x.1`)**: Backward-compatible bug fixes.

---

## Part 2 — Backend & Express Lifecycle Concepts

### 1. What is Express middleware?
An Express middleware is a function with the signature `(req, res, next) => { ... }` that sits in the request pipeline between the raw HTTP server and the final route handler. It can inspect `req`, set headers on `res`, attach event listeners, and call `next()` to pass control to the next middleware or route.

### 2. How does request and response lifecycle tracking work in `src/middleware/create-middleware.js`?
When a request arrives at `sentinel.middleware`:
1. **Ignore Check**: `shouldIgnoreRequest()` checks if the URL path is in `config.ignorePaths` (for example `/api/metrics`). If ignored, it immediately calls `next()`.
2. **Request ID Assignment**: `resolveRequestId()` generates a unique UUID v4 using `crypto.randomUUID()` and attaches it to the outgoing response header (`res.setHeader('X-Request-ID', requestId)`).
3. **Start High-Resolution Timer**: `startRequestTracking(req, requestId)` records `performance.now()` inside a `WeakMap` keyed by `req`.
4. **Completion Listeners**: We register `res.on('finish', onFinish)` and `res.on('close', onClose)` with a boolean guard (`let finalized = false`).
5. **Pass Control**: We call `next()` immediately so the application processes the request with zero blocking.
6. **Finalization**: As soon as Express finishes sending the HTTP response (`'finish'`), or if the client disconnects early (`'close'`), `finalizeRequest()` calculates the elapsed duration, normalizes the route, records the metrics in `MetricsCollector`, and logs a structured event if needed.

### 3. Why do we use `performance.now()` instead of `Date.now()`?
- `Date.now()` only has 1-millisecond precision and can jump backward or forward if the server's system clock syncs via NTP.
- `performance.now()` (from Node's built-in `node:perf_hooks`) uses a **monotonic high-resolution clock** with microsecond/nanosecond precision. It never jumps backward and accurately measures sub-millisecond route durations (e.g., `0.42 ms`).

### 4. How are errors propagated by `sentinel.errorHandler` (`src/middleware/error-handler.js`)?
In Express, error-handling middleware takes **4 arguments**: `(err, req, res, next)`.
- When a route throws an error or calls `next(err)`, Express jumps to `sentinel.errorHandler`.
- Our error handler extracts safe metadata (`errorName` like `'DatabasePoolExhaustedError'` and `errorCode` like `'ECONNREFUSED'`) via `extractSafeErrorMetadata(err)`, saves it on the request's `WeakMap` tracking context, emits an `'error-detected'` event, and **always calls `next(err)`**.
- Calling `next(err)` ensures the application's own error responder still formats and sends the final HTTP 500 response.

---

## Part 3 — Data Structures & Algorithm Concepts

### 1. Why is in-memory storage used, and how are bounded histories implemented?
In-memory storage requires zero external infrastructure (no database or Redis server required to start monitoring) and adds less than `0.25 ms` overhead per request.
To prevent memory leaks in a long-running server, we use **circular ring buffers**:
- **Recent Requests Buffer (`maxRecentRequests = 200`)**: A fixed-length array `new Array(200)` with a pointer `recentWriteIndex`. When the 201st request arrives, `recentWriteIndex` wraps around (`200 % 200 === 0`) and overwrites the oldest entry in $O(1)$ time.

### 2. What is P95 latency, and how is it calculated in `src/core/percentile.js`?
- **Meaning**: The 95th percentile (P95) latency is the response duration below which **95% of observed requests** completed (only the slowest 5% of requests took longer). Unlike the average (mean), P95 is not hidden by lots of fast requests when 5% of users experience severe delays.
- **Bounded Rolling Window (`RollingWindowSampler`)**: We pre-allocate a contiguous typed array `new Float64Array(1000)` (`windowSampleSize = 1000`). Each request writes its duration into `this.buffer[this.writeIndex]` in $O(1)$ time.
- **Nearest-Rank Calculation (`calculatePercentile`)**: When `getMetrics()` is called, we copy the active samples, sort them in ascending order, and pick index:
  $$\text{index} = \lceil 0.95 \times N \rceil - 1$$
  For $N = 100$ sorted samples ($1\text{ ms} \dots 100\text{ ms}$), $\lceil 0.95 \times 100 \rceil - 1 = 94$ (the 95th element, which is `95 ms`).

### 3. Why is route normalization necessary (`src/core/route-normalizer.js`)?
Suppose an API has an endpoint `/api/products/:id` and receives requests for `/api/products/101`, `/api/products/102`, ..., `/api/products/999999`.
- If we used raw URLs as metric keys, we would create 1,000,000 separate entries in memory (**High-Cardinality Explosion**), crashing the server and making per-endpoint averages useless.
- `resolveNormalizedRoute()` solves this in three steps:
  1. If Express matched a route (`req.route.path`), it combines `req.baseUrl + req.route.path` to produce `/api/products/:id`.
  2. If the response is `404` and no route matched, it groups it under `/__unmatched__`.
  3. Otherwise, it strips query strings (`?foo=bar`) and replaces dynamic segments (numeric IDs, UUIDs, 24-character MongoDB ObjectIds, long tokens) with `:id`.

---

## Part 4 — 22 Challenging Faculty Viva Questions & Code-Accurate Answers

### Q1. Why did you implement this package in plain JavaScript instead of TypeScript?
**Answer:** Using modern ES2024 JavaScript with clean modular boundaries and JSDoc annotations allows every line of source code (`src/**/*.js`) to run directly in Node.js without transpilation during development and testing, while keeping the codebase 100% transparent and maintainable for JavaScript developers. For package distribution, `scripts/build.js` uses `esbuild` to output both ESM (`dist/index.js`) and CommonJS (`dist/index.cjs`) bundles.

### Q2. How do you ensure a single HTTP request is never counted twice if both `'finish'` and `'close'` events fire on `res`?
**Answer:** In Node.js's `http.ServerResponse`, the `'close'` event almost always fires right after `'finish'` when the underlying socket or response stream closes. In `src/middleware/create-middleware.js`, we declare a per-request closure variable `let finalized = false;`. The helper `finalizeRequest(aborted)` checks `if (finalized) return;`, immediately sets `finalized = true`, and removes both the `'finish'` and `'close'` event listeners via `res.removeListener()`. Thus, a request is guaranteed to be recorded exactly once.

### Q3. How does API Sentinel detect if a client aborted a request mid-flight?
**Answer:** When the `'close'` event fires on `res` *before* `'finish'`, we inspect `!(res.writableEnded || res.finished)`. If the response had not finished writing when `'close'` occurred, `wasAborted` is `true`. We mark `record.aborted = true`, increment `abortedRequests` in `MetricsCollector`, and if the status code was still the default `200`, we classify it as `499` (Client Closed Request).

### Q4. Why did you use a `WeakMap` in `src/core/request-tracker.js` instead of attaching `req._sentinel = ...` directly to the Express `req` object?
**Answer:** First, mutating private properties onto `req` risks naming collisions with other middleware. Second, a `WeakMap` holds weak references to its object keys (`req`). Once an HTTP request finishes and Express drops its reference to `req`, the V8 garbage collector automatically reclaims the tracking context from the `WeakMap` with zero possibility of a memory leak.

### Q5. What happens if an attacker sends 100,000 requests to random non-existent URLs (`/hack-1`, `/hack-2`, ...)? Will your `endpoints` Map run out of memory?
**Answer:** No, because we have two layers of protection:
1. Unmatched 404 requests (`!req.route && statusCode === 404`) are immediately normalized to a single key: `GET /__unmatched__` in `src/core/route-normalizer.js`.
2. Even for non-404 routes (such as a custom `app.use()` handler), `MetricsCollector` enforces `maxRouteEntries` (default `100`). Once 100 routes are tracked, any additional unseen routes are merged into the single overflow bucket `ALL /__overflow_routes__` (`isOverflowBucket: true`), so `this.endpoints.size` never exceeds `maxRouteEntries`.

### Q6. What happens when the `(maxRouteEntries + 1)`-th distinct route arrives and all `maxRouteEntries` slots are already occupied by normal routes?
**Answer:** In `getOrCreateOverflowBucket()` (`src/core/metrics-collector.js`), if `this.endpoints.size >= this.config.maxRouteEntries` and the overflow bucket does not exist yet, the collector finds the existing non-overflow route with the lowest `requestCount`, merges its counters and latency samples into the newly created `ALL /__overflow_routes__` bucket, deletes the displaced entry, and inserts the overflow bucket. This guarantees `endpoints.length <= maxRouteEntries` under all conditions.

### Q7. What is the worst-case memory complexity of `MetricsCollector`?
**Answer:** The memory complexity is strictly $O(R + M \cdot W)$, where:
- $R = \text{maxRecentRequests}$ (default `200` small JSON objects $\approx 40\text{ KB}$),
- $M = \text{maxRouteEntries}$ (default `100` endpoint states),
- $W = \text{windowSampleSize}$ (default `1000` `Float64Array` elements $= 8\text{ KB}$ per endpoint + $8\text{ KB}$ global).
Even when fully saturated under millions of requests, total memory stays under $\approx 1\text{ MB}$ ($O(1)$ with respect to total lifetime traffic $N$).

### Q8. What is the time complexity of recording a request on the hot path?
**Answer:** Recording a request in `recordRequest()` is $O(1)$:
- Updating global counters and `Float64Array` ring buffer index: $O(1)$.
- Inserting into `recentRequestsBuffer` circular array: $O(1)$.
- Looking up the endpoint in the `Map` and updating its `Float64Array` ring buffer: $O(1)$.
Sorting the rolling window of size $W$ only happens when a developer explicitly reads `getMetrics()` ($O(W \log W)$ where $W \le 1000$), keeping the request hot path extremely fast.

### Q9. Why does `getMetrics()` return deep copies instead of returning `this.statusDistribution` or freezing internal objects?
**Answer:** If we returned references to internal objects, a caller doing `const m = sentinel.getMetrics(); m.totalRequests = 0;` or `m.endpoints.pop()` would corrupt the live metrics collector. By constructing fresh detached objects and arrays on every read (`getMetrics()`, `getRecentRequests()`, `getEndpointMetrics()`), callers can freely transform or serialize the returned data without affecting internal state.

### Q10. Why does API Sentinel ignore incoming `X-Request-ID` headers from clients by default (`trustIncomingRequestId: false`)?
**Answer:** If an unauthenticated external client could supply any string in `X-Request-ID`, they could inject fake correlation IDs to spoof log entries, cause Request ID collisions, or attempt CRLF header-splitting/log-forging attacks. Therefore, `trustIncomingRequestId` defaults to `false`. Even when a developer explicitly enables `trustIncomingRequestId: true` (e.g., behind a trusted API gateway), `isValidIncomingRequestId()` validates the header against `/^[A-Za-z0-9_-]{8,64}$/` and rejects anything else.

### Q11. How do you guarantee that passwords, JWT tokens, cookies, or database credentials never leak into API Sentinel logs?
**Answer:** We enforce privacy at three levels:
1. We never read `req.body`, `req.headers.authorization`, or `req.headers.cookie`.
2. `cleanPathString()` strips the entire query string (`?token=...`) before a route is normalized or stored.
3. `sanitizeLogEvent()` and `extractSafeErrorMetadata()` in `src/utils/sanitizer.js` enforce a strict property whitelist—only `error.name` (e.g., `TypeError`) and `error.code` (e.g., `ECONNREFUSED`) are kept, while `error.message` and `error.stack` are unconditionally discarded.

### Q12. What happens if a developer provides a custom `logging.writer` function that throws an uncaught error?
**Answer:** In `StructuredLogger.emit()` (`src/utils/logger.js`), the entire logging execution—including `sanitizeLogEvent()` and `this.config.writer(sanitized)`—is wrapped in a `try { ... } catch { }` block. Any exception thrown by the writer is caught and suppressed so a broken logger can never crash the Node.js process or cause an HTTP 500 response for the end user.

### Q13. How does Node.js handle concurrency in `MetricsCollector` without locks or mutexes?
**Answer:** Node.js executes JavaScript on a single-threaded event loop. While multiple HTTP requests are in flight concurrently (waiting on asynchronous I/O such as database queries or timers), the synchronous callback inside `res.on('finish')` (`finalizeRequest()`) runs to completion atomically on a single tick of the event loop without preemption. Therefore, integer counter increments and ring-buffer index updates cannot interleave mid-function.

### Q14. What happens if an application runs across 4 Node.js cluster workers or 4 Docker containers? Does API Sentinel share metrics across them?
**Answer:** No—and we explicitly document this limitation. `MetricsCollector` stores metrics in process-local RAM. Each Node.js worker process maintains its own independent in-memory metrics and resets when the process restarts. Sharing metrics across multiple containers requires an external persistence adapter (such as Redis, planned for Phase 2).

### Q15. How does API Sentinel work with both Express 4 and Express 5?
**Answer:** Both Express 4 (`^4.18.0`) and Express 5 (`^5.0.0`) share the standard `(req, res, next)` and `(err, req, res, next)` middleware signatures, `req.baseUrl`, `req.route.path`, and Node's underlying `http.IncomingMessage` / `http.ServerResponse` events (`'finish'`, `'close'`). Our CI workflow (`.github/workflows/ci.yml`) tests the full suite against both Express 4 and Express 5 across Node.js 22 and 24.

### Q16. Why does the demo backend configure `ignorePaths: ['/api/metrics', '/api/metrics/reset']`?
**Answer:** The React dashboard polls `GET /api/metrics` every 2 seconds. If `/api/metrics` were monitored as a normal route, polling the dashboard would continuously increment `totalRequests` even when no real application traffic is occurring. Using `ignorePaths` keeps observability polling out of the application telemetry so the zero-state remains genuinely zero.

### Q17. How does Supertest work in your integration test suite (`tests/integration/express-middleware.test.js`)?
**Answer:** When we pass our Express `app` to `request(app).get('/api/users')`, Supertest automatically binds the Express application to an ephemeral localhost TCP port (`127.0.0.1:0`), sends a real HTTP request through the Node.js HTTP stack, asserts the status code, headers (`x-request-id`), and response payload, and closes the ephemeral server once the request completes.

### Q18. What is the measured performance overhead of API Sentinel in your benchmark?
**Answer:** In `benchmarks/overhead-benchmark.js` (1,500 HTTP GET requests at concurrency 25 on Node.js / Apple M4), baseline Express achieved a P95 latency of `2.41 ms`, while Express with API Sentinel achieved a P95 latency of `2.65 ms`—an overhead of approximately `0.24 ms` per request with logging disabled.

### Q19. Why does `req.route` only exist inside or after a matched Express route handler?
**Answer:** When `app.use(sentinel.middleware)` initially runs at the top of the middleware stack, Express has not yet matched the URL to a specific `app.get('/api/products/:id', ...)` route, so `req.route` is `undefined`. However, because we inspect `req.route` inside the `res.on('finish')` listener—*after* the route handler has executed—`req.route.path` and `req.baseUrl` are populated!

### Q20. What if an authentication middleware rejects a request with `res.status(401).json(...)` before Express ever reaches a route handler?
**Answer:** In that case, `req.route` is `undefined` and `statusCode` is `401` (not `404`). `resolveNormalizedRoute()` falls back to `normalizeDynamicPathSegments(req.originalUrl)`, which strips query strings and replaces any dynamic UUIDs, ObjectIds, or numbers in the path with `:id`.

### Q21. How does API Sentinel compare to enterprise tools like Datadog APM, New Relic, or Sentry?
**Answer:** Enterprise APMs provide distributed tracing across microservices, cloud log ingestion, and long-term time-series storage, but require external agents, API keys, paid subscriptions, and complex setup. API Sentinel is a zero-dependency, in-process Express toolkit that works offline in local development or single-node services in 5 lines of code with zero data leaving the server.

### Q22. How is `/api/metrics` protected against unauthorized public access in the demo application?
**Answer:** In `api-sentinel-demo/backend/app.js`, `/api/metrics` and `/api/metrics/reset` are guarded by `requireLocalOrDemoAccess`. When `process.env.SENTINEL_METRICS_TOKEN` is configured in production, any request without a matching `X-Sentinel-Token` header is rejected with `HTTP 403 Forbidden`.
