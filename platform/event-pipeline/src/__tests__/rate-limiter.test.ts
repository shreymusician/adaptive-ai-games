import { describe, it, expect, vi } from 'vitest';
import { Response } from 'express';
import { RateLimiter, rateLimit } from '../rate-limiter';
import { Logger, MemoryLogSink } from '../logger';
import { MetricsRegistry } from '../metrics';
import { AuthenticatedRequest } from '../auth';

describe('RateLimiter', () => {
  it('allows requests within the limit', () => {
    const limiter = new RateLimiter(1000, 3);
    expect(limiter.check('key1').allowed).toBe(true);
    expect(limiter.check('key1').allowed).toBe(true);
    expect(limiter.check('key1').allowed).toBe(true);
  });

  it('rejects requests beyond the limit within the window', () => {
    const limiter = new RateLimiter(1000, 2);
    expect(limiter.check('key1').allowed).toBe(true);
    expect(limiter.check('key1').allowed).toBe(true);
    const third = limiter.check('key1');
    expect(third.allowed).toBe(false);
    expect(third.retryAfterMs).toBeGreaterThan(0);
  });

  it('tracks separate keys independently', () => {
    const limiter = new RateLimiter(1000, 1);
    expect(limiter.check('key1').allowed).toBe(true);
    expect(limiter.check('key2').allowed).toBe(true);
    expect(limiter.check('key1').allowed).toBe(false);
  });

  it('allows requests again once the window has passed', () => {
    const limiter = new RateLimiter(100, 1);
    const t0 = 1000;
    expect(limiter.check('key1', t0).allowed).toBe(true);
    expect(limiter.check('key1', t0 + 50).allowed).toBe(false);
    expect(limiter.check('key1', t0 + 150).allowed).toBe(true);
  });

  it('reports decreasing remaining count', () => {
    const limiter = new RateLimiter(1000, 5);
    expect(limiter.check('key1').remaining).toBe(4);
    expect(limiter.check('key1').remaining).toBe(3);
  });

  it('sweeps stale keys to bound memory growth', () => {
    const limiter = new RateLimiter(100, 5);
    const t0 = 1000;
    limiter.check('key1', t0);
    limiter.check('key2', t0);
    expect(limiter.size()).toBe(2);
    // trigger a sweep well past the window
    limiter.check('key3', t0 + 500);
    expect(limiter.size()).toBeLessThanOrEqual(2); // key1/key2 should be swept, key3 remains
  });
});

describe('rateLimit middleware', () => {
  function makeRes() {
    const headers: Record<string, string> = {};
    const jsonMock = vi.fn();
    const statusMock = vi.fn().mockReturnValue({ json: jsonMock });
    const res = {
      setHeader: vi.fn((k: string, v: string) => {
        headers[k] = v;
      }),
      status: statusMock,
    } as unknown as Response;
    return { res, headers, statusMock, jsonMock };
  }

  it('calls next() when within limit', () => {
    const limiter = new RateLimiter(1000, 5);
    const metrics = new MetricsRegistry();
    const logger = new Logger(new MemoryLogSink());
    const next = vi.fn();
    const { res } = makeRes();
    const req = { matchToken: { matchId: 'm1' } } as unknown as AuthenticatedRequest;

    rateLimit(limiter, () => 'k', metrics, logger, 'test')(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('returns 429 and sets Retry-After when limit exceeded', () => {
    const limiter = new RateLimiter(60000, 1);
    const metrics = new MetricsRegistry();
    const logger = new Logger(new MemoryLogSink());
    const req = { matchToken: { matchId: 'm1' } } as unknown as AuthenticatedRequest;

    const first = makeRes();
    rateLimit(limiter, () => 'k', metrics, logger, 'test')(req, first.res, vi.fn());

    const second = makeRes();
    const next2 = vi.fn();
    rateLimit(limiter, () => 'k', metrics, logger, 'test')(req, second.res, next2);

    expect(second.statusMock).toHaveBeenCalledWith(429);
    expect(next2).not.toHaveBeenCalled();
    expect(second.headers['Retry-After']).toBeDefined();
    expect(metrics.rateLimitRejections.get({ limiter: 'test' })).toBe(1);
  });
});
