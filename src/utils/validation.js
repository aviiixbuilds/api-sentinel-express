import { CONFIG_BOUNDS, DEFAULT_CONFIG } from '../config/defaults.js';

const HEADER_NAME_REGEX = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function validateNumberRange(value, fieldName, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(
      `Invalid "${fieldName}": expected a finite number, received ${typeof value}.`
    );
  }
  if (value < min || value > max) {
    throw new RangeError(
      `Invalid "${fieldName}": must be between ${min} and ${max}, received ${value}.`
    );
  }
  return value;
}

function validateIntegerRange(value, fieldName, min, max) {
  const num = validateNumberRange(value, fieldName, min, max);
  if (!Number.isInteger(num)) {
    throw new RangeError(`Invalid "${fieldName}": expected an integer, received ${value}.`);
  }
  return num;
}

function resolveLoggerConfig(logging) {
  if (logging === undefined || logging === true) {
    return { ...DEFAULT_CONFIG.logging };
  }

  if (logging === false) {
    return {
      enabled: false,
      logAllRequests: false,
      logSlowRequests: false,
      logServerErrors: false,
      logClientErrors: false,
    };
  }

  if (typeof logging !== 'object' || logging === null || Array.isArray(logging)) {
    throw new TypeError('Invalid "logging" option: expected a boolean or configuration object.');
  }

  if (logging.writer !== undefined && typeof logging.writer !== 'function') {
    throw new TypeError('Invalid "logging.writer": expected a callback function.');
  }

  const resolved = {
    enabled: logging.enabled ?? DEFAULT_CONFIG.logging.enabled,
    logAllRequests: logging.logAllRequests ?? DEFAULT_CONFIG.logging.logAllRequests,
    logSlowRequests: logging.logSlowRequests ?? DEFAULT_CONFIG.logging.logSlowRequests,
    logServerErrors: logging.logServerErrors ?? DEFAULT_CONFIG.logging.logServerErrors,
    logClientErrors: logging.logClientErrors ?? DEFAULT_CONFIG.logging.logClientErrors,
  };

  if (typeof resolved.enabled !== 'boolean') {
    throw new TypeError('Invalid "logging.enabled": expected a boolean.');
  }

  if (logging.writer) {
    resolved.writer = logging.writer;
  }

  return resolved;
}

/**
 * Validates user-supplied configuration options and merges them with defaults.
 *
 * @param {object} [config={}] - User configuration options.
 * @returns {object} Frozen, validated configuration object.
 */
export function resolveAndValidateConfig(config = {}) {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new TypeError('Invalid configuration: expected a plain configuration object.');
  }

  const slowRequestThresholdMs =
    config.slowRequestThresholdMs !== undefined
      ? validateNumberRange(
          config.slowRequestThresholdMs,
          'slowRequestThresholdMs',
          CONFIG_BOUNDS.slowRequestThresholdMs.min,
          CONFIG_BOUNDS.slowRequestThresholdMs.max
        )
      : DEFAULT_CONFIG.slowRequestThresholdMs;

  const maxRecentRequests =
    config.maxRecentRequests !== undefined
      ? validateIntegerRange(
          config.maxRecentRequests,
          'maxRecentRequests',
          CONFIG_BOUNDS.maxRecentRequests.min,
          CONFIG_BOUNDS.maxRecentRequests.max
        )
      : DEFAULT_CONFIG.maxRecentRequests;

  const maxRouteEntries =
    config.maxRouteEntries !== undefined
      ? validateIntegerRange(
          config.maxRouteEntries,
          'maxRouteEntries',
          CONFIG_BOUNDS.maxRouteEntries.min,
          CONFIG_BOUNDS.maxRouteEntries.max
        )
      : DEFAULT_CONFIG.maxRouteEntries;

  const windowSampleSize =
    config.windowSampleSize !== undefined
      ? validateIntegerRange(
          config.windowSampleSize,
          'windowSampleSize',
          CONFIG_BOUNDS.windowSampleSize.min,
          CONFIG_BOUNDS.windowSampleSize.max
        )
      : DEFAULT_CONFIG.windowSampleSize;

  const requestIdHeader = config.requestIdHeader ?? DEFAULT_CONFIG.requestIdHeader;
  if (
    typeof requestIdHeader !== 'string' ||
    requestIdHeader.trim().length === 0 ||
    !HEADER_NAME_REGEX.test(requestIdHeader)
  ) {
    throw new TypeError(
      'Invalid "requestIdHeader": must be a valid non-empty HTTP header token string.'
    );
  }

  const trustIncomingRequestId =
    config.trustIncomingRequestId ?? DEFAULT_CONFIG.trustIncomingRequestId;
  if (typeof trustIncomingRequestId !== 'boolean') {
    throw new TypeError('Invalid "trustIncomingRequestId": expected a boolean.');
  }

  const ignorePaths = config.ignorePaths ?? [];
  if (typeof ignorePaths !== 'function' && !Array.isArray(ignorePaths)) {
    throw new TypeError(
      'Invalid "ignorePaths": expected an array of strings/RegExps or a predicate function.'
    );
  }

  if (Array.isArray(ignorePaths)) {
    for (const item of ignorePaths) {
      if (typeof item !== 'string' && !(item instanceof RegExp)) {
        throw new TypeError(
          'Invalid "ignorePaths" element: every item must be a string or RegExp.'
        );
      }
    }
  }

  const fallbackRouteLabel = config.fallbackRouteLabel ?? DEFAULT_CONFIG.fallbackRouteLabel;
  if (typeof fallbackRouteLabel !== 'string' || !fallbackRouteLabel.startsWith('/')) {
    throw new TypeError('Invalid "fallbackRouteLabel": must be a string starting with "/".');
  }

  const unmatchedRouteLabel = config.unmatchedRouteLabel ?? DEFAULT_CONFIG.unmatchedRouteLabel;
  if (typeof unmatchedRouteLabel !== 'string' || !unmatchedRouteLabel.startsWith('/')) {
    throw new TypeError('Invalid "unmatchedRouteLabel": must be a string starting with "/".');
  }

  return Object.freeze({
    slowRequestThresholdMs,
    maxRecentRequests,
    maxRouteEntries,
    windowSampleSize,
    requestIdHeader,
    trustIncomingRequestId,
    logging: Object.freeze(resolveLoggerConfig(config.logging)),
    ignorePaths,
    fallbackRouteLabel,
    unmatchedRouteLabel,
  });
}
