import { randomUUID } from 'node:crypto';

/**
 * Strict validation pattern for optional incoming request IDs when `trustIncomingRequestId: true`.
 * Allows only URL-safe alphanumeric characters, hyphens, and underscores between 8 and 64 characters.
 * Prevents header splitting (CRLF), log injection, and oversized header attacks.
 */
const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Generates a cryptographically strong UUID v4 request identifier.
 *
 * @returns {string} Unique request ID.
 */
export function generateRequestId() {
  return randomUUID();
}

/**
 * Validates whether an incoming header value is safe to adopt as a request ID.
 *
 * @param {unknown} candidate - Incoming header value.
 * @returns {boolean} True if valid and safe.
 */
export function isValidIncomingRequestId(candidate) {
  return typeof candidate === 'string' && SAFE_REQUEST_ID_PATTERN.test(candidate);
}

/**
 * Resolves the request ID for an incoming Express request.
 * By default (`trustIncoming = false`), always generates a fresh UUID v4 and ignores client headers.
 *
 * @param {object} req - Express request object.
 * @param {string} headerName - Header name to inspect if trustIncoming is enabled.
 * @param {boolean} [trustIncoming=false] - Whether to trust validated client request IDs.
 * @returns {string} Resolved request ID.
 */
export function resolveRequestId(req, headerName, trustIncoming = false) {
  if (trustIncoming && req && req.headers) {
    const rawHeader = req.headers[String(headerName).toLowerCase()];
    const candidate = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    if (isValidIncomingRequestId(candidate)) {
      return candidate;
    }
  }
  return generateRequestId();
}
