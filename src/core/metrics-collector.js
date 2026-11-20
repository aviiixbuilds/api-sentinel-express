import { RollingWindowSampler, roundDuration } from './percentile.js';

/**
 * Bounded, in-memory metrics aggregator for API Sentinel.
 *
 * Designed for deterministic memory consumption:
 * - Recent request history is stored in a fixed-size circular ring buffer (`maxRecentRequests`).
 * - Endpoint analytics are capped at `maxRouteEntries` with automatic overflow aggregation.
 * - Latency percentiles use fixed-size `Float64Array` ring buffers (`windowSampleSize`).
 * - All public read methods return detached deep copies so callers can never mutate internal state.
 */
export class MetricsCollector {
  /**
   * @param {object} config - Resolved API Sentinel configuration.
   */
  constructor(config) {
    this.config = config;
    this.startedAt = new Date();
    this.totalRequests = 0;
    this.informationalRequests = 0;
    this.successfulRequests = 0;
    this.redirectRequests = 0;
    this.notModifiedRequests = 0;
    this.clientErrorRequests = 0;
    this.serverErrorRequests = 0;
    this.notFoundRequests = 0;
    this.unmatchedRouteRequests = 0;
    this.slowRequests = 0;
    this.abortedRequests = 0;
    this.cardinalityOverflowCount = 0;

    this.totalDurationMs = 0;
    this.minDurationMs = Number.POSITIVE_INFINITY;
    this.maxDurationMs = 0;
    this.globalLatencySampler = new RollingWindowSampler(config.windowSampleSize);

    this.statusDistribution = {
      '1xx': 0,
      '2xx': 0,
      '3xx': 0,
      '4xx': 0,
      '5xx': 0,
    };
    this.statusCodeCounts = new Map();
    this.endpoints = new Map();
    this.recentRequestsBuffer = new Array(config.maxRecentRequests);
    this.recentWriteIndex = 0;
    this.recentCount = 0;
  }

  /**
   * Records a completed HTTP request into global counters, recent request history,
   * and per-endpoint analytics.
   *
   * @param {object} record - Completed request telemetry record.
   */
  recordRequest(record) {
    const duration = roundDuration(record.durationMs);
    const status = record.statusCode;

    this.totalRequests += 1;
    this.totalDurationMs += duration;

    if (duration < this.minDurationMs) {
      this.minDurationMs = duration;
    }
    if (duration > this.maxDurationMs) {
      this.maxDurationMs = duration;
    }
    this.globalLatencySampler.add(duration);

    if (record.isSlow) {
      this.slowRequests += 1;
    }
    if (record.isUnmatchedRoute) {
      this.unmatchedRouteRequests += 1;
    }
    if (record.aborted) {
      this.abortedRequests += 1;
    }

    const statusKey = String(status);
    this.statusCodeCounts.set(statusKey, (this.statusCodeCounts.get(statusKey) ?? 0) + 1);

    if (status === 404) {
      this.notFoundRequests += 1;
    }

    if (status >= 500) {
      this.serverErrorRequests += 1;
      this.statusDistribution['5xx'] += 1;
    } else if (status >= 400) {
      this.clientErrorRequests += 1;
      this.statusDistribution['4xx'] += 1;
    } else if (status >= 300) {
      if (status === 304) {
        this.notModifiedRequests += 1;
      } else {
        this.redirectRequests += 1;
      }
      this.statusDistribution['3xx'] += 1;
    } else if (status >= 200) {
      this.successfulRequests += 1;
      this.statusDistribution['2xx'] += 1;
    } else {
      this.informationalRequests += 1;
      this.statusDistribution['1xx'] += 1;
    }

    this.appendRecentRequest(record);
    this.recordEndpointMetrics(record, duration);
  }

  /**
   * Appends a cloned request record to the bounded circular buffer.
   *
   * @param {object} record - Completed request record.
   */
  appendRecentRequest(record) {
    const clonedRecord = {
      requestId: record.requestId,
      timestamp: record.timestamp,
      method: record.method,
      route: record.route,
      statusCode: record.statusCode,
      durationMs: roundDuration(record.durationMs),
      isSlow: Boolean(record.isSlow),
      outcome: record.outcome,
      isUnmatchedRoute: Boolean(record.isUnmatchedRoute),
      aborted: Boolean(record.aborted),
    };

    if (record.errorName !== undefined) {
      clonedRecord.errorName = record.errorName;
    }
    if (record.errorCode !== undefined) {
      clonedRecord.errorCode = record.errorCode;
    }

    this.recentRequestsBuffer[this.recentWriteIndex] = clonedRecord;
    this.recentWriteIndex = (this.recentWriteIndex + 1) % this.config.maxRecentRequests;
    if (this.recentCount < this.config.maxRecentRequests) {
      this.recentCount += 1;
    }
  }

  /**
   * Updates per-endpoint metrics while strictly enforcing `maxRouteEntries`.
   *
   * @param {object} record - Completed request record.
   * @param {number} duration - Rounded duration in milliseconds.
   */
  recordEndpointMetrics(record, duration) {
    const method = record.method.toUpperCase();
    const route = record.route;
    const endpointKey = `${method} ${route}`;
    const overflowKey = `ALL ${this.config.fallbackRouteLabel}`;

    let state = this.endpoints.get(endpointKey);

    if (!state) {
      if (this.endpoints.size < this.config.maxRouteEntries) {
        state = this.createEmptyEndpointState(endpointKey, method, route, record.timestamp, false);
        this.endpoints.set(endpointKey, state);
      } else {
        this.cardinalityOverflowCount += 1;
        state = this.getOrCreateOverflowBucket(overflowKey, record.timestamp);
      }
    }

    this.applyRequestToEndpointState(state, record, duration);
  }

  /**
   * Obtains or creates the overflow bucket when `maxRouteEntries` is reached.
   * If all `maxRouteEntries` slots are currently occupied by normal routes, the least-frequently
   * hit normal route is merged into the new overflow bucket so total entries never exceed `maxRouteEntries`.
   *
   * @param {string} overflowKey - Canonical key for the overflow bucket.
   * @param {string} timestamp - ISO timestamp.
   * @returns {object} Mutable overflow endpoint state.
   */
  getOrCreateOverflowBucket(overflowKey, timestamp) {
    const existingOverflow = this.endpoints.get(overflowKey);
    if (existingOverflow) {
      return existingOverflow;
    }

    const overflowState = this.createEmptyEndpointState(
      overflowKey,
      'ALL',
      this.config.fallbackRouteLabel,
      timestamp,
      true
    );

    if (this.endpoints.size >= this.config.maxRouteEntries) {
      let victimKey;
      let victimState;

      for (const [key, candidate] of this.endpoints.entries()) {
        if (candidate.isOverflowBucket) {
          continue;
        }
        if (!victimState || candidate.requestCount < victimState.requestCount) {
          victimKey = key;
          victimState = candidate;
        }
      }

      if (victimKey && victimState) {
        this.endpoints.delete(victimKey);
        this.mergeEndpointState(overflowState, victimState);
      }
    }

    this.endpoints.set(overflowKey, overflowState);
    return overflowState;
  }

  createEmptyEndpointState(key, method, route, timestamp, isOverflowBucket) {
    return {
      key,
      method,
      route,
      requestCount: 0,
      informationalCount: 0,
      successCount: 0,
      redirectCount: 0,
      notModifiedCount: 0,
      errorCount: 0,
      clientErrorCount: 0,
      serverErrorCount: 0,
      slowRequestCount: 0,
      totalDurationMs: 0,
      minDurationMs: Number.POSITIVE_INFINITY,
      maxDurationMs: 0,
      sampler: new RollingWindowSampler(this.config.windowSampleSize),
      lastSeenAt: timestamp,
      isOverflowBucket,
    };
  }

  mergeEndpointState(target, source) {
    target.requestCount += source.requestCount;
    target.informationalCount += source.informationalCount;
    target.successCount += source.successCount;
    target.redirectCount += source.redirectCount;
    target.notModifiedCount += source.notModifiedCount;
    target.errorCount += source.errorCount;
    target.clientErrorCount += source.clientErrorCount;
    target.serverErrorCount += source.serverErrorCount;
    target.slowRequestCount += source.slowRequestCount;
    target.totalDurationMs += source.totalDurationMs;

    if (source.minDurationMs < target.minDurationMs) {
      target.minDurationMs = source.minDurationMs;
    }
    if (source.maxDurationMs > target.maxDurationMs) {
      target.maxDurationMs = source.maxDurationMs;
    }
    for (const sample of source.sampler.getSamples()) {
      target.sampler.add(sample);
    }
    if (source.lastSeenAt > target.lastSeenAt) {
      target.lastSeenAt = source.lastSeenAt;
    }
  }

  applyRequestToEndpointState(state, record, duration) {
    state.requestCount += 1;
    state.totalDurationMs += duration;
    if (duration < state.minDurationMs) {
      state.minDurationMs = duration;
    }
    if (duration > state.maxDurationMs) {
      state.maxDurationMs = duration;
    }
    state.sampler.add(duration);
    state.lastSeenAt = record.timestamp;

    if (record.isSlow) {
      state.slowRequestCount += 1;
    }

    if (record.statusCode >= 500) {
      state.serverErrorCount += 1;
      state.errorCount += 1;
    } else if (record.statusCode >= 400) {
      state.clientErrorCount += 1;
      state.errorCount += 1;
    } else if (record.statusCode >= 300) {
      if (record.statusCode === 304) {
        state.notModifiedCount += 1;
      } else {
        state.redirectCount += 1;
      }
    } else if (record.statusCode >= 200) {
      state.successCount += 1;
    } else {
      state.informationalCount += 1;
    }
  }

  /**
   * Returns a detached array of per-endpoint analytics sorted by request volume.
   *
   * @returns {object[]} Detached list of endpoint metric objects.
   */
  getEndpointMetrics() {
    const endpointsList = [];

    for (const state of this.endpoints.values()) {
      const epAvg =
        state.requestCount > 0 ? roundDuration(state.totalDurationMs / state.requestCount) : 0;
      const epMin =
        state.requestCount > 0 && Number.isFinite(state.minDurationMs) ? state.minDurationMs : 0;
      const epMax = state.requestCount > 0 ? state.maxDurationMs : 0;

      endpointsList.push({
        key: state.key,
        method: state.method,
        route: state.route,
        requestCount: state.requestCount,
        informationalCount: state.informationalCount,
        successCount: state.successCount,
        redirectCount: state.redirectCount,
        notModifiedCount: state.notModifiedCount,
        errorCount: state.errorCount,
        clientErrorCount: state.clientErrorCount,
        serverErrorCount: state.serverErrorCount,
        slowRequestCount: state.slowRequestCount,
        avgDurationMs: epAvg,
        minDurationMs: epMin,
        maxDurationMs: epMax,
        p95DurationMs: state.sampler.getPercentile(95),
        lastSeenAt: state.lastSeenAt,
        isOverflowBucket: state.isOverflowBucket,
      });
    }

    endpointsList.sort((a, b) => {
      if (a.isOverflowBucket !== b.isOverflowBucket) {
        return a.isOverflowBucket ? 1 : -1;
      }
      return b.requestCount - a.requestCount || b.p95DurationMs - a.p95DurationMs;
    });

    return endpointsList;
  }

  /**
   * Produces a detached, deeply cloned snapshot of all collected metrics.
   *
   * @returns {object} Detached metrics snapshot.
   */
  getMetrics() {
    const now = new Date();
    const uptimeSeconds = Math.max(
      0,
      roundDuration((now.getTime() - this.startedAt.getTime()) / 1000)
    );

    const hasRequests = this.totalRequests > 0;
    const totalErrors = this.clientErrorRequests + this.serverErrorRequests;
    const errorRate = hasRequests ? roundDuration((totalErrors / this.totalRequests) * 100) : 0;
    const slowRequestRate = hasRequests
      ? roundDuration((this.slowRequests / this.totalRequests) * 100)
      : 0;

    const avgMs = hasRequests ? roundDuration(this.totalDurationMs / this.totalRequests) : 0;
    const minMs = hasRequests && Number.isFinite(this.minDurationMs) ? this.minDurationMs : 0;
    const maxMs = hasRequests ? this.maxDurationMs : 0;
    const p95Ms = hasRequests ? this.globalLatencySampler.getPercentile(95) : 0;

    const statusDistributionCopy = {
      '1xx': this.statusDistribution['1xx'],
      '2xx': this.statusDistribution['2xx'],
      '3xx': this.statusDistribution['3xx'],
      '4xx': this.statusDistribution['4xx'],
      '5xx': this.statusDistribution['5xx'],
    };

    const statusCodeCountsCopy = {};
    for (const [code, count] of this.statusCodeCounts.entries()) {
      statusCodeCountsCopy[code] = count;
    }

    return {
      generatedAt: now.toISOString(),
      startedAt: this.startedAt.toISOString(),
      uptimeSeconds,
      totalRequests: this.totalRequests,
      informationalRequests: this.informationalRequests,
      successfulRequests: this.successfulRequests,
      redirectRequests: this.redirectRequests,
      notModifiedRequests: this.notModifiedRequests,
      clientErrorRequests: this.clientErrorRequests,
      serverErrorRequests: this.serverErrorRequests,
      notFoundRequests: this.notFoundRequests,
      unmatchedRouteRequests: this.unmatchedRouteRequests,
      slowRequests: this.slowRequests,
      abortedRequests: this.abortedRequests,
      errorRate,
      slowRequestRate,
      latency: {
        avgMs,
        minMs,
        maxMs,
        p95Ms,
        sampleCount: this.globalLatencySampler.size(),
      },
      statusDistribution: statusDistributionCopy,
      statusCodeCounts: statusCodeCountsCopy,
      endpoints: this.getEndpointMetrics(),
      cardinalityOverflowCount: this.cardinalityOverflowCount,
      config: {
        slowRequestThresholdMs: this.config.slowRequestThresholdMs,
        maxRecentRequests: this.config.maxRecentRequests,
        maxRouteEntries: this.config.maxRouteEntries,
        windowSampleSize: this.config.windowSampleSize,
        requestIdHeader: this.config.requestIdHeader,
      },
    };
  }

  /**
   * Returns a detached array of cloned recent request records ordered from newest to oldest.
   *
   * @param {number} [limit] - Optional maximum number of records to return.
   * @returns {object[]} Array of recent request records.
   */
  getRecentRequests(limit) {
    if (limit !== undefined) {
      if (typeof limit !== 'number' || !Number.isFinite(limit)) {
        throw new TypeError(`Invalid "limit": expected a finite number, received ${typeof limit}.`);
      }
      if (limit <= 0) {
        return [];
      }
    }

    const maxToReturn =
      limit !== undefined ? Math.min(Math.floor(limit), this.recentCount) : this.recentCount;
    const results = [];

    for (let i = 0; i < maxToReturn; i += 1) {
      const bufferIndex =
        (this.recentWriteIndex - 1 - i + this.config.maxRecentRequests) %
        this.config.maxRecentRequests;
      const item = this.recentRequestsBuffer[bufferIndex];
      if (item) {
        const copy = {
          requestId: item.requestId,
          timestamp: item.timestamp,
          method: item.method,
          route: item.route,
          statusCode: item.statusCode,
          durationMs: item.durationMs,
          isSlow: item.isSlow,
          outcome: item.outcome,
          isUnmatchedRoute: item.isUnmatchedRoute,
          aborted: item.aborted,
        };
        if (item.errorName !== undefined) {
          copy.errorName = item.errorName;
        }
        if (item.errorCode !== undefined) {
          copy.errorCode = item.errorCode;
        }
        results.push(copy);
      }
    }

    return results;
  }

  /**
   * Resets all in-memory metrics, latency buffers, endpoint records, and recent request history.
   */
  reset() {
    this.startedAt = new Date();
    this.totalRequests = 0;
    this.informationalRequests = 0;
    this.successfulRequests = 0;
    this.redirectRequests = 0;
    this.notModifiedRequests = 0;
    this.clientErrorRequests = 0;
    this.serverErrorRequests = 0;
    this.notFoundRequests = 0;
    this.unmatchedRouteRequests = 0;
    this.slowRequests = 0;
    this.abortedRequests = 0;
    this.cardinalityOverflowCount = 0;

    this.totalDurationMs = 0;
    this.minDurationMs = Number.POSITIVE_INFINITY;
    this.maxDurationMs = 0;
    this.globalLatencySampler.reset();

    this.statusDistribution = {
      '1xx': 0,
      '2xx': 0,
      '3xx': 0,
      '4xx': 0,
      '5xx': 0,
    };
    this.statusCodeCounts.clear();
    this.endpoints.clear();
    this.recentRequestsBuffer = new Array(this.config.maxRecentRequests);
    this.recentWriteIndex = 0;
    this.recentCount = 0;
  }
}
