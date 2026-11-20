const SAFE_IDENTIFIER_REGEX = /^[A-Za-z0-9_.:-]+$/;

/**
 * Builds a strictly whitelisted structured log event object.
 * Guarantees that request bodies, query parameters, passwords, authorization headers,
 * cookies, session tokens, and raw stack traces are never included in monitoring events.
 *
 * @param {object} event - Raw candidate log event.
 * @returns {object} Frozen, sanitized log event with whitelisted properties only.
 */
export function sanitizeLogEvent(event) {
  const clean = {
    type: String(event.type),
    requestId: String(event.requestId),
    method: String(event.method).toUpperCase(),
    route: String(event.route),
    statusCode: Number(event.statusCode),
    durationMs: Number(event.durationMs),
    timestamp: String(event.timestamp),
  };

  if (event.outcome !== undefined) {
    clean.outcome = String(event.outcome);
  }
  if (event.isSlow !== undefined) {
    clean.isSlow = Boolean(event.isSlow);
  }
  if (event.isUnmatchedRoute !== undefined) {
    clean.isUnmatchedRoute = Boolean(event.isUnmatchedRoute);
  }
  if (event.aborted !== undefined) {
    clean.aborted = Boolean(event.aborted);
  }
  if (event.errorName !== undefined) {
    clean.errorName = String(event.errorName).slice(0, 120);
  }
  if (event.errorCode !== undefined) {
    clean.errorCode = String(event.errorCode).slice(0, 64);
  }

  return Object.freeze(clean);
}

/**
 * Extracts strictly privacy-safe classification metadata from an unknown error object.
 * Never extracts error messages, stack traces, SQL queries, or request payloads.
 *
 * @param {unknown} err - Error passed to Express error middleware.
 * @returns {{ errorName: string, errorCode?: string }} Safe error classification metadata.
 */
export function extractSafeErrorMetadata(err) {
  if (err === null || err === undefined) {
    return { errorName: 'UnknownError' };
  }

  if (typeof err === 'object') {
    let rawName = 'Error';
    if (typeof err.name === 'string' && err.name.trim().length > 0) {
      rawName = err.name.trim();
    } else if (
      err.constructor &&
      typeof err.constructor.name === 'string' &&
      err.constructor.name.trim().length > 0
    ) {
      rawName = err.constructor.name.trim();
    }

    const sanitizedName = SAFE_IDENTIFIER_REGEX.test(rawName)
      ? rawName.slice(0, 80)
      : 'ApplicationError';

    let sanitizedCode;
    if (typeof err.code === 'string' && SAFE_IDENTIFIER_REGEX.test(err.code)) {
      sanitizedCode = err.code.slice(0, 64);
    } else if (typeof err.code === 'number' && Number.isFinite(err.code)) {
      sanitizedCode = String(err.code);
    }

    const result = { errorName: sanitizedName };
    if (sanitizedCode !== undefined) {
      result.errorCode = sanitizedCode;
    }
    return result;
  }

  return { errorName: 'NonObjectThrown' };
}
