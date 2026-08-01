import { createHmac, timingSafeEqual } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { EventPipelineConfig } from './config';
import { AuthenticationError, AuthorizationError } from './errors';
import { Logger } from './logger';
import { MetricsRegistry } from './metrics';

/**
 * Match-scoped authentication. Deliberately NOT the long-lived player
 * session JWT used by platform/api — per PLATFORM_V2_DESIGN.md §7/§8, event
 * ingestion uses a short-lived, narrowly-scoped token minted when a match
 * starts, so a leaked ingestion token only ever exposes one match's event
 * stream, never a player's whole session.
 *
 * Implemented with Node's builtin `crypto` (HMAC-SHA256) rather than pulling
 * in `jsonwebtoken` — the claim set is small and fixed, and avoiding the
 * dependency keeps this package's trust surface minimal for a
 * security-sensitive module.
 */

export type TokenScope = 'ingest' | 'replay' | 'admin';

export interface MatchTokenClaims {
  matchId: string;
  playerId: string;
  gameId: string;
  scope: TokenScope;
  iat: number; // seconds since epoch
  exp: number; // seconds since epoch
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(payload: string, secret: string): string {
  return base64url(createHmac('sha256', secret).update(payload).digest());
}

/** Mints a new match-scoped token. `ttlSeconds` overrides config default when provided. */
export function mintMatchToken(
  claims: Pick<MatchTokenClaims, 'matchId' | 'playerId' | 'gameId' | 'scope'>,
  config: EventPipelineConfig,
  ttlSeconds?: number
): string {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + (ttlSeconds ?? config.matchTokenTtlSeconds);
  const fullClaims: MatchTokenClaims = { ...claims, iat, exp };

  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'MATCH' }));
  const body = base64url(JSON.stringify(fullClaims));
  const signature = sign(`${header}.${body}`, config.matchTokenSecret);
  return `${header}.${body}.${signature}`;
}

/** Verifies a match token's signature and expiry. Throws AuthenticationError on any failure. */
export function verifyMatchToken(token: string, config: EventPipelineConfig): MatchTokenClaims {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new AuthenticationError('Malformed token');
  }
  const [header, body, signature] = parts;

  const expectedSignature = sign(`${header}.${body}`, config.matchTokenSecret);
  const expectedBuf = Buffer.from(expectedSignature);
  const actualBuf = Buffer.from(signature);
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
    throw new AuthenticationError('Invalid token signature');
  }

  let claims: MatchTokenClaims;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw new AuthenticationError('Malformed token payload');
  }

  if (
    typeof claims.matchId !== 'string' ||
    typeof claims.playerId !== 'string' ||
    typeof claims.gameId !== 'string' ||
    typeof claims.exp !== 'number' ||
    typeof claims.iat !== 'number'
  ) {
    throw new AuthenticationError('Malformed token claims');
  }

  const now = Math.floor(Date.now() / 1000);
  if (claims.exp < now) {
    throw new AuthenticationError('Token expired');
  }

  return claims;
}

export interface AuthenticatedRequest extends Request {
  matchToken?: MatchTokenClaims;
}

/**
 * Express middleware factory: requires a valid Bearer match token with at
 * least `minScope`. Rejects (401/403) before the request body is ever
 * touched by validation or the EventProcessor — this is the enforcement
 * point for "unauthorized requests must never reach the Event Processor."
 */
export function requireMatchToken(config: EventPipelineConfig, logger: Logger, metrics: MetricsRegistry, minScope: TokenScope = 'ingest') {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

    if (!token) {
      metrics.authFailures.inc({ reason: 'missing_token' });
      logger.warn('Rejected request: missing bearer token', { path: req.path });
      res.status(401).json({ error: 'Authentication token required', code: 'AUTHENTICATION_FAILED' });
      return;
    }

    let claims: MatchTokenClaims;
    try {
      claims = verifyMatchToken(token, config);
    } catch (err) {
      metrics.authFailures.inc({ reason: 'invalid_token' });
      logger.warn('Rejected request: invalid token', { path: req.path, error: err instanceof Error ? err.message : String(err) });
      res.status(401).json({ error: err instanceof Error ? err.message : 'Invalid token', code: 'AUTHENTICATION_FAILED' });
      return;
    }

    if (!scopeSatisfies(claims.scope, minScope)) {
      metrics.authFailures.inc({ reason: 'insufficient_scope' });
      logger.warn('Rejected request: insufficient scope', { path: req.path, have: claims.scope, need: minScope });
      res.status(403).json({ error: `Token scope '${claims.scope}' insufficient, requires '${minScope}'`, code: 'AUTHORIZATION_FAILED' });
      return;
    }

    req.matchToken = claims;
    next();
  };
}

const SCOPE_RANK: Record<TokenScope, number> = { ingest: 1, replay: 2, admin: 3 };

function scopeSatisfies(have: TokenScope, need: TokenScope): boolean {
  return SCOPE_RANK[have] >= SCOPE_RANK[need];
}

/** Authorization check: does this token permit reading events for `matchId`? */
export function assertMatchAccess(claims: MatchTokenClaims, matchId: string): void {
  if (claims.scope === 'admin') return;
  if (claims.matchId === matchId) return;
  throw new AuthorizationError(`Token is not authorized for match ${matchId}`);
}

/** Authorization check: does this token permit reading events for `playerId`? */
export function assertPlayerAccess(claims: MatchTokenClaims, playerId: string): void {
  if (claims.scope === 'admin') return;
  if (claims.playerId === playerId) return;
  throw new AuthorizationError(`Token is not authorized for player ${playerId}`);
}

/** Authorization check: game-wide queries require admin scope — broad, cross-player data. */
export function assertGameAccess(claims: MatchTokenClaims): void {
  if (claims.scope === 'admin') return;
  throw new AuthorizationError('Game-wide queries require admin scope');
}
