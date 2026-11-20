# Engineering Design Decisions & Trade-Offs

## 1. Plain Modern JavaScript (ES2024) with Dual ESM/CJS Output

- **Decision**: Implement the source codebase in modular ES2024 JavaScript (`src/**/*.js`) with comprehensive JSDoc annotations, and bundle both ESM (`dist/index.js`) and CommonJS (`dist/index.cjs`) outputs using `esbuild`.
- **Rationale**: Ensures the entire codebase is directly readable, debuggable, and maintainable by JavaScript and Node.js developers without requiring a TypeScript compiler toolchain, while supporting both modern `"type": "module"` projects (`import`) and legacy CommonJS projects (`require`).

## 2. Per-Request Context Storage via `WeakMap`

- **Decision**: Associate tracking metadata (`requestId`, `startTimeMs`, `errorName`, `errorCode`) with the Express `req` object using a module-scoped `WeakMap` (`src/core/request-tracker.js`) rather than mutating arbitrary properties onto `req`.
- **Rationale**:
  - Avoids property collisions with user middleware or Express internals.
  - Guarantees automatic garbage collection as soon as the `IncomingMessage` (`req`) object leaves scope—even if a broken third-party middleware drops a request without ending the response.

## 3. High-Resolution Monotonic Timing (`performance.now()`)

- **Decision**: Measure request duration using `performance.now()` from `node:perf_hooks` instead of `Date.now()`.
- **Rationale**: `Date.now()` has millisecond precision and is susceptible to wall-clock adjustments (NTP clock skew or leap seconds). `performance.now()` uses a monotonic high-resolution clock with sub-millisecond precision, allowing accurate measurement of fast in-memory routes (`0.15 ms`).

## 4. Fixed-Capacity `Float64Array` Circular Buffers for Rolling P95

- **Decision**: Compute P95 latency over a bounded rolling window (`windowSampleSize`, default `1000`) stored in a pre-allocated `Float64Array` ring buffer (`RollingWindowSampler`).
- **Rationale**:
  - Storing every latency value since process startup causes unbounded memory growth and biases percentiles toward stale historical traffic.
  - A circular `Float64Array(1000)` occupies exactly `8,000 bytes`, achieves $O(1)$ insertion with zero heap allocations per request, and reflects recent service health when computing nearest-rank P95 on read.

## 5. Multi-Tier Route Normalization & Cardinality Protection

- **Decision**: Normalize routes in three tiers (`src/core/route-normalizer.js` and `src/core/metrics-collector.js`):
  1. Prefer Express's matched route template (`req.baseUrl + req.route.path`, e.g., `/api/products/:id`).
  2. Group all unmatched 404 responses under `/__unmatched__`.
  3. Normalize dynamic segments (UUIDs, 24-hex ObjectIds, numeric IDs, long alphanumeric tokens) into `:id`, and enforce a hard cap (`maxRouteEntries: 100`) with a fallback overflow bucket (`ALL /__overflow_routes__`).
- **Rationale**: Without cardinality protection, an attacker or automated vulnerability scanner requesting 50,000 random URLs (`/random-1`, `/random-2`, ...) would allocate 50,000 endpoint metric objects and crash the Node.js process.

## 6. Detached Deep Clones Instead of Frozen Shared References

- **Decision**: `getMetrics()`, `getRecentRequests()`, and `getEndpointMetrics()` return freshly allocated deep copies of internal state.
- **Rationale**: If a consumer modifies `const m = sentinel.getMetrics(); m.totalRequests = 0;`, returning an internal reference would corrupt collector state, whereas returning a shallowly/deeply frozen object can throw unexpected `TypeError` exceptions in consumers that mutate response objects before serialization. Returning detached copies guarantees complete isolation without throwing runtime mutation errors in consumer code.
