/**
 * Durable AI-engine identity for one Colyseus room participant, resolved
 * from a verified platform match token (never from anything a client sends
 * unsigned). See `AdaptedGameRoom.resolvePlatformIdentity` for how this is
 * produced, and `live-room-controller.ts` for where it's consumed at the
 * boundary where identity reaches CanonicalEvents / MemoryEngine.
 */
export interface PlatformIdentity {
  /** Verified platform playerId (JWT subject, via the match token) — the durable AI Engine identity. Falls back to the Colyseus sessionId only for connections that never presented a verified token (the server-injected AI bot). */
  playerId: string;
  /** Verified matchId from the token (one per POST /api/match/start call) — falls back to a `${roomId}::${sessionId}` composite for unverified connections, matching the pre-1c behavior. */
  matchId: string;
  gameId: string;
}
