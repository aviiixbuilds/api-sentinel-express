/**
 * Rounds a floating-point duration value to 2 decimal places.
 *
 * @param {number} value - Duration in milliseconds.
 * @returns {number} Rounded duration (>= 0).
 */
export function roundDuration(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.round(value * 100) / 100;
}

/**
 * Computes the given percentile (e.g. 95 for P95) over an array of numeric latency samples
 * using the standard nearest-rank method:
 *
 *   rank = ceil((P / 100) * N)
 *   value = sorted[rank - 1]
 *
 * Returns `0` when the sample array is empty.
 *
 * @param {number[]} samples - Array of latency samples in milliseconds.
 * @param {number} [percentile=95] - Target percentile in range (0, 100].
 * @returns {number} Calculated percentile value rounded to 2 decimal places.
 */
export function calculatePercentile(samples, percentile = 95) {
  if (
    typeof percentile !== 'number' ||
    percentile <= 0 ||
    percentile > 100 ||
    !Number.isFinite(percentile)
  ) {
    throw new RangeError(
      `Invalid percentile "${percentile}": must be a number in the range (0, 100].`
    );
  }

  if (!Array.isArray(samples) || samples.length === 0) {
    return 0;
  }

  const count = samples.length;
  if (count === 1) {
    return roundDuration(samples[0] ?? 0);
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const rankIndex = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentile / 100) * count) - 1)
  );

  return roundDuration(sorted[rankIndex] ?? 0);
}

/**
 * Fixed-capacity circular ring buffer for bounded-memory rolling percentile calculations.
 *
 * Insertion is O(1) and uses a pre-allocated Float64Array so long-running Node.js processes
 * never suffer from unbounded array allocations or memory leaks.
 */
export class RollingWindowSampler {
  /**
   * @param {number} [capacity=1000] - Maximum number of samples retained in the rolling window.
   */
  constructor(capacity = 1000) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError('RollingWindowSampler capacity must be a positive integer.');
    }
    this.capacity = capacity;
    this.buffer = new Float64Array(capacity);
    this.writeIndex = 0;
    this.currentSize = 0;
  }

  /**
   * Adds a new latency sample (in milliseconds) to the rolling window in O(1) time.
   *
   * @param {number} durationMs - Observed latency in milliseconds.
   */
  add(durationMs) {
    if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) {
      return;
    }
    this.buffer[this.writeIndex] = durationMs;
    this.writeIndex = (this.writeIndex + 1) % this.capacity;
    if (this.currentSize < this.capacity) {
      this.currentSize += 1;
    }
  }

  /**
   * Returns the current number of active samples in the rolling window (0 <= size <= capacity).
   *
   * @returns {number} Active sample count.
   */
  size() {
    return this.currentSize;
  }

  /**
   * Extracts a copy of the active samples currently stored in the ring buffer.
   *
   * @returns {number[]} Detached array of active latency samples.
   */
  getSamples() {
    const result = new Array(this.currentSize);
    for (let i = 0; i < this.currentSize; i += 1) {
      result[i] = this.buffer[i] ?? 0;
    }
    return result;
  }

  /**
   * Computes the target percentile (defaults to 95th percentile) over the current rolling window.
   *
   * @param {number} [percentile=95] - Target percentile (0, 100].
   * @returns {number} Percentile latency in milliseconds.
   */
  getPercentile(percentile = 95) {
    if (this.currentSize === 0) {
      return 0;
    }
    return calculatePercentile(this.getSamples(), percentile);
  }

  /**
   * Clears all samples in the rolling window.
   */
  reset() {
    this.writeIndex = 0;
    this.currentSize = 0;
    this.buffer.fill(0);
  }
}
