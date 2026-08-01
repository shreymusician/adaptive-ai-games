import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth';
import { Logger } from './logger';
import { MetricsRegistry } from './metrics';

/**
 * Sliding-window rate limiter, in-memory. Good enough for a single pipeline
 * instance; a multi-instance deployment would back this with Redis instead
 * (INCR + EXPIRE), but the interface below (`check(key)`) is the same
 * either way, so that swap doesn't touch call sites.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private lastSweep = Date.now();

  constructor(
    private readonly windowMs: number,
    private readonly maxRequests: number
  ) {}

  /** Records a hit for `key` and reports whether it's within the limit. */
  check(key: string, now: number = Date.now()): { allowed: boolean; retryAfterMs: number; remaining: number } {
    this.sweepIfDue(now);

    let timestamps = this.hits.get(key);
    if (!timestamps) {
      timestamps = [];
      this.hits.set(key, timestamps);
    }

    const windowStart = now - this.windowMs;
    while (timestamps.length > 0 && timestamps[0] < windowStart) {
      timestamps.shift();
    }

    if (timestamps.length >= this.maxRequests) {
      const retryAfterMs = timestamps[0] + this.windowMs - now;
      return { allowed: false, retryAfterMs: Math.max(retryAfterMs, 0), remaining: 0 };
    }

    timestamps.push(now);
    return { allowed: true, retryAfterMs: 0, remaining: this.maxRequests - timestamps.length };
  }

  /** Periodically drops keys with no recent hits so memory doesn't grow unbounded. */
  private sweepIfDue(now: number): void {
    if (now - this.lastSweep < this.windowMs) return;
    this.lastSweep = now;
    const windowStart = now - this.windowMs;
    for (const [key, timestamps] of this.hits) {
      const stillLive = timestamps.filter((t) => t >= windowStart);
      if (stillLive.length === 0) {
        this.hits.delete(key);
      } else {
        this.hits.set(key, stillLive);
      }
    }
  }

  /** Test/ops helper: current tracked key count. */
  size(): number {
    return this.hits.size;
  }
}

export type RateLimitKeyFn = (req: AuthenticatedRequest) => string;

/** Express middleware factory wrapping a RateLimiter. */
export function rateLimit(limiter: RateLimiter, keyFn: RateLimitKeyFn, metrics: MetricsRegistry, logger: Logger, label: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const key = keyFn(req);
    const result = limiter.check(key);

    if (!result.allowed) {
      metrics.rateLimitRejections.inc({ limiter: label });
      logger.warn('Rate limit exceeded', { limiter: label, key, retryAfterMs: result.retryAfterMs });
      res.setHeader('Retry-After', Math.ceil(result.retryAfterMs / 1000).toString());
      res.status(429).json({
        error: 'Rate limit exceeded',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfterMs: result.retryAfterMs,
      });
      return;
    }

    res.setHeader('X-RateLimit-Remaining', result.remaining.toString());
    next();
  };
}
