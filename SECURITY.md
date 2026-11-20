# Security and Privacy Policy — API Sentinel (`api-sentinel-express`)

## 1. Privacy-First Engineering Principles

API Sentinel is designed from the ground up with **privacy-by-default** and **zero external telemetry**:

1. **No External Network Transmission**: The package makes zero outbound HTTP requests, opens zero sockets, and never transmits telemetry to third-party servers. All metrics remain strictly in the host Node.js process memory.
2. **No Request Body Capture**: `req.body` is never read, inspected, cloned, or stored under any configuration.
3. **No Sensitive Header or Cookie Capture**: `Authorization`, `Cookie`, `Set-Cookie`, `X-API-Key`, and all other HTTP request headers are excluded from metrics snapshots, recent request records, and structured logs.
4. **Query-String Stripping**: `cleanPathString()` in `src/core/route-normalizer.js` strips all query parameters (`?token=...&password=...`) and URL fragments (`#...`) before recording routes or emitting logs.
5. **Dynamic URL Normalization**: Raw dynamic path segments (numeric IDs, UUIDs, MongoDB ObjectIds, long opaque tokens) are collapsed into `:id` or matched against Express `req.route.path` templates so user-specific identifiers in URLs do not leak into endpoint metric keys.
6. **Stack Trace & Exception Message Suppression**: `extractSafeErrorMetadata()` in `src/utils/sanitizer.js` records only the sanitized error class name (`errorName`, e.g., `DatabaseError`) and standard error code (`errorCode`, e.g., `ECONNREFUSED`). Raw `err.message` and `err.stack` strings—which frequently contain database connection strings, SQL queries, or PII—are never stored in metrics or emitted by API Sentinel.
7. **Untrusted Incoming Request IDs by Default**: By default (`trustIncomingRequestId: false`), API Sentinel ignores client-supplied `X-Request-ID` headers and generates a fresh cryptographic UUID v4 via `crypto.randomUUID()`. When `trustIncomingRequestId: true` is explicitly enabled, incoming IDs are validated against `/^[A-Za-z0-9_-]{8,64}$/` to prevent CRLF header splitting and log injection.
8. **Zero Runtime Dependencies**: `api-sentinel-express` has zero runtime `dependencies` in `package.json` (relying only on built-in Node.js modules `node:crypto` and `node:perf_hooks`, plus `express` as a peer dependency), minimizing supply-chain attack surface.

---

## 2. Safe Exposure of Metrics Endpoints

API Sentinel provides programmatic methods (`sentinel.getMetrics()`, `sentinel.getRecentRequests()`, `sentinel.getEndpointMetrics()`) and does **not** automatically mount any public HTTP route on your Express application.

If you expose a metrics route (such as `GET /internal/metrics` or `GET /api/metrics`), you must protect it in production environments:

- Restrict access to internal private networks / VPCs or localhost.
- Require authentication middleware (e.g., mutual TLS, Bearer JWT, or an internal API token header such as `X-Sentinel-Token`).
- Do not expose internal endpoint metrics publicly on the open internet without access control.

---

## 3. Bounded Memory & Denial-of-Service (DoS) Protection

To protect the host Node.js process from memory exhaustion under high traffic or malicious URL-scanning attacks:

- **Unmatched 404 Grouping**: All unmatched 404 requests are automatically grouped under `/__unmatched__`, preventing random bot scanner URLs from creating thousands of metric entries.
- **Endpoint Cardinality Cap (`maxRouteEntries`)**: Capped at `100` routes by default. Any excess routes are aggregated into a single fallback bucket (`ALL /__overflow_routes__`).
- **Fixed Circular Ring Buffers**: Recent request history (`maxRecentRequests`, default `200`) and P95 latency windows (`windowSampleSize`, default `1000` using pre-allocated `Float64Array` buffers) overwrite the oldest entries in $O(1)$ time.

---

## 4. Supported Versions

| Version | Supported | Node.js Compatibility | Express Compatibility |
| :--- | :--- | :--- | :--- |
| `1.0.x` | Yes | Node.js `>= 20.0.0` (Tested on 22 & 24) | Express `^4.18.0 \|\| ^5.0.0` |

---

## 5. Reporting a Vulnerability

If you discover a security or privacy vulnerability in `api-sentinel-express`:

1. **Do not open a public GitHub issue.**
2. Report the finding privately to the maintainer via email (`your-email@example.com`) or through GitHub Private Vulnerability Reporting on the repository's **Security** tab.
3. Include a minimal reproduction script, affected configuration options, and potential impact.
4. You will receive an acknowledgment within 48 hours and a remediation timeline once triaged.
