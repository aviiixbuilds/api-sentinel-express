# Changelog

All notable changes to **`api-sentinel-express`** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-11-18

### Added
- **Core Express Middleware (`createApiSentinel`)**: Automatic lifecycle tracking for incoming HTTP requests and completed/aborted responses using high-resolution `performance.now()` timing.
- **Request ID Generation & Correlation**: Cryptographic UUID v4 generation via `node:crypto` (`randomUUID()`), automatic `X-Request-ID` response header injection, and strict validation for optional incoming correlation IDs.
- **Response-Time & Rolling P95 Analytics**: Fixed-capacity `Float64Array` circular ring buffer (`RollingWindowSampler`) providing $O(1)$ sample insertion and nearest-rank P95 latency calculation both globally and per endpoint.
- **Slow API Detection**: Configurable `slowRequestThresholdMs` (default `500ms`) with automatic flagging, counter aggregation, and structured `'slow-request'` warning events.
- **HTTP Status & Error Classification**: Tracks `1xx`, `2xx`, `3xx`, `4xx`, `404`, `5xx`, unmatched routes, and prematurely aborted connections.
- **Express Error-Handling Middleware (`sentinel.errorHandler`)**: Captures privacy-safe error classification metadata (`errorName`, `errorCode`) and forwards errors via `next(err)` without swallowing exceptions or leaking stack traces.
- **Route Normalization & Cardinality Protection**: Combines Express `req.baseUrl` + `req.route.path`, strips query strings, normalizes dynamic UUID/ObjectId/numeric path segments into `:id`, groups unmatched 404s under `/__unmatched__`, and enforces `maxRouteEntries` via an overflow bucket (`/__overflow_routes__`).
- **Privacy-First Structured Logger**: Machine-readable JSON event logging with custom `writer` callback support, strict field whitelisting, and complete failure isolation (`try / catch`).
- **Dual ESM & CommonJS Build**: Built with `esbuild` producing `dist/index.js` (ESM) and `dist/index.cjs` (CommonJS) with zero runtime dependencies.
