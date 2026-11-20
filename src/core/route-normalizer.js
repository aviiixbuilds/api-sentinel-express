const UUID_SEGMENT_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OBJECT_ID_SEGMENT_REGEX = /^[0-9a-f]{24}$/i;
const NUMERIC_SEGMENT_REGEX = /^\d+$/;
const LONG_TOKEN_SEGMENT_REGEX = /^(?=.*\d)[A-Za-z0-9_-]{12,}$/;
const HEX_HASH_SEGMENT_REGEX = /^[0-9a-f]{16,}$/i;

/**
 * Strips query parameters and hash fragments from a URL or path and normalizes slashes.
 * Guarantees query-string values never leak into route keys or logs.
 *
 * @param {string} rawUrl - Raw URL or route path.
 * @returns {string} Cleaned path string starting with "/".
 */
export function cleanPathString(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return '/';
  }

  const withoutQuery = rawUrl.split('?')[0]?.split('#')[0]?.trim() ?? '/';
  if (withoutQuery.length === 0) {
    return '/';
  }

  const withLeadingSlash = withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;
  const collapsedSlashes = withLeadingSlash.replace(/\/+/g, '/');

  if (collapsedSlashes.length > 1 && collapsedSlashes.endsWith('/')) {
    return collapsedSlashes.slice(0, -1);
  }

  return collapsedSlashes;
}

/**
 * Normalizes dynamic path segments (numeric IDs, UUIDs, MongoDB ObjectIds, long opaque tokens)
 * into canonical `:id` placeholders to prevent high-cardinality metrics explosion when
 * an Express route template is not available.
 *
 * @param {string} rawUrl - Raw URL or path.
 * @returns {string} Normalized path template.
 */
export function normalizeDynamicPathSegments(rawUrl) {
  const cleaned = cleanPathString(rawUrl);
  if (cleaned === '/') {
    return '/';
  }

  const segments = cleaned.split('/').filter((seg) => seg.length > 0);
  const normalizedSegments = segments.map((segment) => {
    if (segment.startsWith(':')) {
      return segment;
    }
    if (
      NUMERIC_SEGMENT_REGEX.test(segment) ||
      UUID_SEGMENT_REGEX.test(segment) ||
      OBJECT_ID_SEGMENT_REGEX.test(segment) ||
      HEX_HASH_SEGMENT_REGEX.test(segment) ||
      LONG_TOKEN_SEGMENT_REGEX.test(segment)
    ) {
      return ':id';
    }
    return segment;
  });

  return `/${normalizedSegments.join('/')}`;
}

/**
 * Resolves the canonical normalized route template for an Express request.
 *
 * Priority:
 * 1. If Express matched a route (`req.route.path`), combine `req.baseUrl` + `req.route.path`.
 * 2. If no Express route matched and the response status is 404, classify as an unmatched route
 *    using `unmatchedRouteLabel` (default `/__unmatched__`) to prevent 404 cardinality explosion.
 * 3. Otherwise (e.g., middleware-terminated requests such as 401/403 or `app.use` handlers),
 *    strip query strings and normalize dynamic URL segments into `:id`.
 *
 * @param {object} req - Express request object.
 * @param {number} statusCode - Final HTTP status code.
 * @param {string} [unmatchedRouteLabel='/__unmatched__'] - Label for unmatched 404 routes.
 * @returns {{ route: string, isUnmatchedRoute: boolean }} Normalized route metadata.
 */
export function resolveNormalizedRoute(req, statusCode, unmatchedRouteLabel = '/__unmatched__') {
  const matchedRoute = req && req.route;

  if (matchedRoute && matchedRoute.path !== undefined) {
    const baseUrl = typeof req.baseUrl === 'string' ? req.baseUrl : '';
    const routePath =
      typeof matchedRoute.path === 'string'
        ? matchedRoute.path
        : Array.isArray(matchedRoute.path) && typeof matchedRoute.path[0] === 'string'
          ? matchedRoute.path[0]
          : String(matchedRoute.path);

    const combined = cleanPathString(`${baseUrl}/${routePath}`);
    return {
      route: combined,
      isUnmatchedRoute: false,
    };
  }

  if (statusCode === 404) {
    return {
      route: cleanPathString(unmatchedRouteLabel),
      isUnmatchedRoute: true,
    };
  }

  const rawCandidate =
    (req && typeof req.originalUrl === 'string' && req.originalUrl) ||
    (req && typeof req.url === 'string' && req.url) ||
    (req && typeof req.path === 'string' && req.path) ||
    '/';

  return {
    route: normalizeDynamicPathSegments(rawCandidate),
    isUnmatchedRoute: false,
  };
}
