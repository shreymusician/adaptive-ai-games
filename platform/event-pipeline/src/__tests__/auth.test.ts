import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Response, NextFunction } from 'express';
import { loadConfig } from '../config';
import { Logger, MemoryLogSink } from '../logger';
import { MetricsRegistry } from '../metrics';
import {
  mintMatchToken,
  verifyMatchToken,
  requireMatchToken,
  assertMatchAccess,
  assertPlayerAccess,
  assertGameAccess,
  AuthenticatedRequest,
} from '../auth';
import { AuthenticationError, AuthorizationError } from '../errors';

const config = loadConfig({ matchTokenSecret: 'test-secret', matchTokenTtlSeconds: 3600 });

describe('mintMatchToken / verifyMatchToken', () => {
  it('mints a token that verifies successfully', () => {
    const token = mintMatchToken({ matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'ingest' }, config);
    const claims = verifyMatchToken(token, config);
    expect(claims.matchId).toBe('m1');
    expect(claims.playerId).toBe('p1');
    expect(claims.gameId).toBe('g1');
    expect(claims.scope).toBe('ingest');
  });

  it('rejects a token signed with a different secret', () => {
    const token = mintMatchToken({ matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'ingest' }, config);
    const otherConfig = loadConfig({ matchTokenSecret: 'different-secret' });
    expect(() => verifyMatchToken(token, otherConfig)).toThrow(AuthenticationError);
  });

  it('rejects a malformed token (wrong number of parts)', () => {
    expect(() => verifyMatchToken('not-a-real-token', config)).toThrow(AuthenticationError);
  });

  it('rejects a tampered payload', () => {
    const token = mintMatchToken({ matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'ingest' }, config);
    const parts = token.split('.');
    const tamperedPayload = Buffer.from(JSON.stringify({ matchId: 'm2', playerId: 'p1', gameId: 'g1', scope: 'admin', iat: 0, exp: 9999999999 })).toString(
      'base64url'
    );
    const tampered = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
    expect(() => verifyMatchToken(tampered, config)).toThrow(AuthenticationError);
  });

  it('rejects an expired token', () => {
    const token = mintMatchToken({ matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'ingest' }, config, -10);
    expect(() => verifyMatchToken(token, config)).toThrow(/expired/i);
  });

  it('respects a custom ttlSeconds override', () => {
    const token = mintMatchToken({ matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'replay' }, config, 1);
    const claims = verifyMatchToken(token, config);
    expect(claims.exp - claims.iat).toBe(1);
  });
});

describe('requireMatchToken middleware', () => {
  let metrics: MetricsRegistry;
  let logger: Logger;
  let sink: MemoryLogSink;
  let res: Response;
  let statusMock: ReturnType<typeof vi.fn>;
  let jsonMock: ReturnType<typeof vi.fn>;
  let next: NextFunction;

  beforeEach(() => {
    metrics = new MetricsRegistry();
    sink = new MemoryLogSink();
    logger = new Logger(sink);
    jsonMock = vi.fn();
    statusMock = vi.fn().mockReturnValue({ json: jsonMock });
    res = { status: statusMock } as unknown as Response;
    next = vi.fn();
  });

  function makeReq(headers: Record<string, string> = {}): AuthenticatedRequest {
    return { headers, path: '/test' } as unknown as AuthenticatedRequest;
  }

  it('calls next() and attaches matchToken for a valid token', () => {
    const token = mintMatchToken({ matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'ingest' }, config);
    const req = makeReq({ authorization: `Bearer ${token}` });
    requireMatchToken(config, logger, metrics, 'ingest')(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.matchToken?.matchId).toBe('m1');
  });

  it('returns 401 when no Authorization header is present', () => {
    const req = makeReq();
    requireMatchToken(config, logger, metrics, 'ingest')(req, res, next);
    expect(statusMock).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    expect(metrics.authFailures.get({ reason: 'missing_token' })).toBe(1);
  });

  it('returns 401 for an invalid token', () => {
    const req = makeReq({ authorization: 'Bearer garbage' });
    requireMatchToken(config, logger, metrics, 'ingest')(req, res, next);
    expect(statusMock).toHaveBeenCalledWith(401);
    expect(metrics.authFailures.get({ reason: 'invalid_token' })).toBe(1);
  });

  it('returns 403 when scope is insufficient', () => {
    const token = mintMatchToken({ matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'ingest' }, config);
    const req = makeReq({ authorization: `Bearer ${token}` });
    requireMatchToken(config, logger, metrics, 'admin')(req, res, next);
    expect(statusMock).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
    expect(metrics.authFailures.get({ reason: 'insufficient_scope' })).toBe(1);
  });

  it('allows a higher-scoped token to satisfy a lower requirement', () => {
    const token = mintMatchToken({ matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'admin' }, config);
    const req = makeReq({ authorization: `Bearer ${token}` });
    requireMatchToken(config, logger, metrics, 'ingest')(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('logs a warning on rejection', () => {
    const req = makeReq();
    requireMatchToken(config, logger, metrics, 'ingest')(req, res, next);
    expect(sink.records.some((r) => r.level === 'warn')).toBe(true);
  });
});

describe('authorization assertions', () => {
  const ingestClaims = { matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'ingest' as const, iat: 0, exp: 9999999999 };
  const adminClaims = { matchId: 'm1', playerId: 'p1', gameId: 'g1', scope: 'admin' as const, iat: 0, exp: 9999999999 };

  it('assertMatchAccess allows own match, denies others', () => {
    expect(() => assertMatchAccess(ingestClaims, 'm1')).not.toThrow();
    expect(() => assertMatchAccess(ingestClaims, 'm2')).toThrow(AuthorizationError);
  });

  it('assertMatchAccess allows admin scope for any match', () => {
    expect(() => assertMatchAccess(adminClaims, 'some-other-match')).not.toThrow();
  });

  it('assertPlayerAccess allows own player, denies others', () => {
    expect(() => assertPlayerAccess(ingestClaims, 'p1')).not.toThrow();
    expect(() => assertPlayerAccess(ingestClaims, 'p2')).toThrow(AuthorizationError);
  });

  it('assertGameAccess requires admin scope', () => {
    expect(() => assertGameAccess(ingestClaims)).toThrow(AuthorizationError);
    expect(() => assertGameAccess(adminClaims)).not.toThrow();
  });
});
