import { sanitizeLogEvent } from './sanitizer.js';

/**
 * Structured logger that safely emits machine-readable monitoring events.
 * Any exception thrown by a custom writer or console output is caught and suppressed
 * so logging failures can never crash or interrupt the host Express application.
 */
export class StructuredLogger {
  /**
   * @param {object} loggingConfig - Resolved logging configuration.
   */
  constructor(loggingConfig) {
    this.config = loggingConfig;
  }

  /**
   * Emits a single structured log event if logging is enabled.
   *
   * @param {object} event - Event record to emit.
   */
  emit(event) {
    if (!this.config || !this.config.enabled) {
      return;
    }

    try {
      const sanitized = sanitizeLogEvent(event);

      if (typeof this.config.writer === 'function') {
        this.config.writer(sanitized);
        return;
      }

      const serialized = JSON.stringify(sanitized);
      if (sanitized.type === 'server-error' || sanitized.type === 'error-detected') {
        console.error(serialized);
      } else if (sanitized.type === 'slow-request' || sanitized.type === 'client-error') {
        console.warn(serialized);
      } else {
        console.info(serialized);
      }
    } catch {
      // Never allow logging failures to crash or disrupt the host application.
    }
  }

  /**
   * Evaluates a completed request and emits the appropriate structured event(s)
   * according to the active logging configuration.
   *
   * @param {object} record - Completed request record.
   */
  logCompletedRequest(record) {
    if (!this.config || !this.config.enabled) {
      return;
    }

    const isServerError = record.statusCode >= 500;
    const isClientError = record.statusCode >= 400 && record.statusCode < 500;
    const isSlow = Boolean(record.isSlow);

    if (isServerError && this.config.logServerErrors) {
      this.emit({ ...record, type: 'server-error' });
    } else if (isClientError && this.config.logClientErrors) {
      this.emit({ ...record, type: 'client-error' });
    }

    if (isSlow && this.config.logSlowRequests) {
      this.emit({ ...record, type: 'slow-request' });
    }

    if (
      this.config.logAllRequests &&
      !isSlow &&
      !(isServerError && this.config.logServerErrors) &&
      !(isClientError && this.config.logClientErrors)
    ) {
      this.emit({ ...record, type: 'request-completed' });
    }
  }
}
