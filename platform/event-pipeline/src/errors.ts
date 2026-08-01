/**
 * Typed error hierarchy for the Event Pipeline. Every error the HTTP layer
 * can return to a caller is represented here with a stable `code` (safe to
 * put in a response body / log line / alert rule) and an HTTP `status`.
 * Router code should catch these and translate directly; anything that
 * escapes uncaught is treated as an internal error (500) and logged loudly.
 */
export abstract class PipelineError extends Error {
  abstract readonly code: string;
  abstract readonly status: number;

  toResponseBody(): { error: string; code: string; details?: unknown } {
    return { error: this.message, code: this.code };
  }
}

export class AuthenticationError extends PipelineError {
  readonly code = 'AUTHENTICATION_FAILED';
  readonly status = 401;
  constructor(message: string = 'Authentication failed') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends PipelineError {
  readonly code = 'AUTHORIZATION_FAILED';
  readonly status = 403;
  constructor(message: string = 'Not authorized for this resource') {
    super(message);
    this.name = 'AuthorizationError';
  }
}

export class ValidationFailedError extends PipelineError {
  readonly code = 'VALIDATION_FAILED';
  readonly status = 400;
  constructor(
    message: string,
    public readonly details: string[] = []
  ) {
    super(message);
    this.name = 'ValidationFailedError';
  }
  override toResponseBody() {
    return { error: this.message, code: this.code, details: this.details };
  }
}

export class PayloadTooLargeError extends PipelineError {
  readonly code = 'PAYLOAD_TOO_LARGE';
  readonly status = 413;
  constructor(message: string = 'Request payload exceeds the configured limit') {
    super(message);
    this.name = 'PayloadTooLargeError';
  }
}

export class RateLimitExceededError extends PipelineError {
  readonly code = 'RATE_LIMIT_EXCEEDED';
  readonly status = 429;
  constructor(
    message: string,
    public readonly retryAfterMs: number
  ) {
    super(message);
    this.name = 'RateLimitExceededError';
  }
  override toResponseBody() {
    return { error: this.message, code: this.code, retryAfterMs: this.retryAfterMs };
  }
}

export class NotFoundError extends PipelineError {
  readonly code = 'NOT_FOUND';
  readonly status = 404;
  constructor(message: string = 'Resource not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ServiceUnavailableError extends PipelineError {
  readonly code = 'SERVICE_UNAVAILABLE';
  readonly status = 503;
  constructor(message: string = 'Dependency unavailable') {
    super(message);
    this.name = 'ServiceUnavailableError';
  }
}

export function isPipelineError(err: unknown): err is PipelineError {
  return err instanceof PipelineError;
}
