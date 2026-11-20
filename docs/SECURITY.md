# Security & Privacy Architecture

See the root [SECURITY.md](../SECURITY.md) for the complete security policy, privacy guarantees, threat model, and vulnerability reporting instructions.

## Whitelisted Telemetry Schema

Every record emitted by `StructuredLogger` (`src/utils/logger.js`) passes through `sanitizeLogEvent()` (`src/utils/sanitizer.js`), which enforces a strict property whitelist:

| Field | Type | Description |
| :--- | :--- | :--- |
| `type` | `string` | `'request-completed' \| 'slow-request' \| 'client-error' \| 'server-error' \| 'error-detected'` |
| `requestId` | `string` | Cryptographic UUID v4 (or validated alphanumeric correlation ID) |
| `method` | `string` | Uppercase HTTP verb (`GET`, `POST`, etc.) |
| `route` | `string` | Normalized route template with query strings stripped |
| `statusCode` | `number` | Numeric HTTP response status code |
| `durationMs` | `number` | High-resolution elapsed time in milliseconds |
| `timestamp` | `string` | ISO 8601 UTC timestamp |
| `outcome` | `string` | `'success' \| 'redirect' \| 'client_error' \| 'server_error' \| 'informational'` |
| `isSlow` | `boolean` | Whether `durationMs > slowRequestThresholdMs` |
| `isUnmatchedRoute` | `boolean` | Whether the request resulted in an unmatched 404 |
| `aborted` | `boolean` | Whether the client connection closed prematurely |
| `errorName` | `string?` | Sanitized error class/constructor name (max 120 chars, alphanumeric/identifier only) |
| `errorCode` | `string?` | Sanitized system/library error code (max 64 chars) |

Any property not in the table above is unconditionally dropped.
