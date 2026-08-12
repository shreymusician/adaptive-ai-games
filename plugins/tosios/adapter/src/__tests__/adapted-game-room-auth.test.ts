/**
 * Milestone 1c — security tests for AdaptedGameRoom.onAuth, the new
 * Colyseus lifecycle hook that verifies a platform match token before any
 * client-declared identity is trusted. Uses the REAL mintMatchToken /
 * verifyMatchToken (re-exported from @adaptive-ai/orchestration, which
 * already depends on @adaptive-ai/event-pipeline) — no fake auth
 * implementation.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Client } from 'colyseus';
import { AdaptedGameRoom } from '../adapted-game-room';
import { mintMatchToken, verifyMatchToken, loadEventPipelineConfig } from '@adaptive-ai/orchestration';
import type { EventPipelineConfig } from '@adaptive-ai/orchestration';
import { Types } from '../../vendor-dist/common/src';

const GAME_ID = 'tosios';

const config: EventPipelineConfig = loadEventPipelineConfig({ matchTokenSecret: 'test-secret-1c', matchTokenTtlSeconds: 3600 });

function mint(overrides: Partial<{ matchId: string; playerId: string; gameId: string; scope: 'ingest' | 'replay' | 'admin' }> = {}, ttlSeconds?: number) {
  return mintMatchToken(
    {
      matchId: overrides.matchId ?? 'match-1',
      playerId: overrides.playerId ?? 'player-1',
      gameId: overrides.gameId ?? GAME_ID,
      scope: overrides.scope ?? 'ingest',
    },
    config,
    ttlSeconds
  );
}

function roomOptions(matchToken?: string, extra: Partial<Types.RoomOptions & { matchId?: string; playerId?: string }> = {}): Types.RoomOptions & { matchToken?: string } {
  return {
    playerName: 'Alice',
    roomName: 'room',
    roomMap: 'small',
    roomMaxPlayers: 4,
    mode: 'deathmatch',
    matchToken,
    ...extra,
  };
}

function fakeClient(sessionId: string): Client {
  return { sessionId } as Client;
}

/** In a real deployment, Colyseus's own MatchMaker assigns `listing` before `onCreate` runs — stub the same shape here since these tests construct a Room directly, bypassing the matchmaker (setMetadata, called by the vendored GameRoom.onCreate, needs it). */
function stubListing(room: AdaptedGameRoom): void {
  (room as unknown as { listing: { metadata?: unknown } }).listing = { metadata: {} };
}

function buildAuthedRoom(): AdaptedGameRoom {
  const room = new AdaptedGameRoom();
  stubListing(room);
  room.auth = { verify: (token: string) => verifyMatchToken(token, config), gameId: GAME_ID };
  room.onCreate(roomOptions(undefined) as Types.RoomOptions);
  return room;
}

describe('AdaptedGameRoom.onAuth — Milestone 1c security', () => {
  let room: AdaptedGameRoom;

  beforeEach(() => {
    room = buildAuthedRoom();
  });

  it('accepts a valid token and resolves it into the durable platform identity', async () => {
    const token = mint({ playerId: 'p-real', matchId: 'm-real' });
    const claims = await room.onAuth(fakeClient('sess-1'), roomOptions(token));
    expect(claims).not.toBe(true);
    room.onJoin(fakeClient('sess-1'), roomOptions(token), claims);

    const identity = room.resolvePlatformIdentity('sess-1');
    expect(identity.playerId).toBe('p-real');
    expect(identity.matchId).toBe('m-real');
    expect(identity.gameId).toBe(GAME_ID);
  });

  it('rejects a missing token', async () => {
    await expect(room.onAuth(fakeClient('sess-1'), roomOptions(undefined))).rejects.toThrow(/matchToken is required/i);
  });

  it('rejects a malformed token (not header.body.signature)', async () => {
    await expect(room.onAuth(fakeClient('sess-1'), roomOptions('not-a-real-token'))).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const token = mint({}, -10); // already expired
    await expect(room.onAuth(fakeClient('sess-1'), roomOptions(token))).rejects.toThrow();
  });

  it('rejects a tampered token (signature no longer matches claims)', async () => {
    const token = mint({ playerId: 'p-real' });
    const [header, body, signature] = token.split('.');
    const flippedSig = signature.slice(0, -1) + (signature.at(-1) === 'A' ? 'B' : 'A');
    const tampered = `${header}.${body}.${flippedSig}`;
    await expect(room.onAuth(fakeClient('sess-1'), roomOptions(tampered))).rejects.toThrow();
  });

  it('rejects insufficient scope', async () => {
    const token = mint({ scope: 'replay' });
    await expect(room.onAuth(fakeClient('sess-1'), roomOptions(token))).rejects.toThrow(/scope/i);
  });

  it('rejects a wrong gameId', async () => {
    const token = mint({ gameId: 'some-other-game' });
    await expect(room.onAuth(fakeClient('sess-1'), roomOptions(token))).rejects.toThrow(/game/i);
  });

  it('rejects when the client-declared matchId disagrees with the token\'s own matchId', async () => {
    const token = mint({ matchId: 'match-A' });
    await expect(room.onAuth(fakeClient('sess-1'), roomOptions(token, { matchId: 'match-B' }))).rejects.toThrow(/matchId/i);
  });

  it('ignores an arbitrary, unsigned client-declared playerId — resolved identity always comes from the verified token', async () => {
    const token = mint({ playerId: 'real-player' });
    const claims = await room.onAuth(fakeClient('sess-1'), roomOptions(token, { playerId: 'attacker-spoofed-id' } as Partial<Types.RoomOptions>));
    room.onJoin(fakeClient('sess-1'), roomOptions(token), claims);

    expect(room.resolvePlatformIdentity('sess-1').playerId).toBe('real-player');
    expect(room.resolvePlatformIdentity('sess-1').playerId).not.toBe('attacker-spoofed-id');
  });

  it('a token minted for player A cannot resolve as player B — claims from the verified token always win, never a client override', async () => {
    const tokenForA = mint({ playerId: 'player-A', matchId: 'match-A' });
    const claimsA = await room.onAuth(fakeClient('sess-A'), roomOptions(tokenForA));
    room.onJoin(fakeClient('sess-A'), roomOptions(tokenForA), claimsA);

    const tokenForB = mint({ playerId: 'player-B', matchId: 'match-B' });
    const claimsB = await room.onAuth(fakeClient('sess-B'), roomOptions(tokenForB));
    room.onJoin(fakeClient('sess-B'), roomOptions(tokenForB), claimsB);

    expect(room.resolvePlatformIdentity('sess-A').playerId).toBe('player-A');
    expect(room.resolvePlatformIdentity('sess-B').playerId).toBe('player-B');
    expect(room.resolvePlatformIdentity('sess-A').playerId).not.toBe(room.resolvePlatformIdentity('sess-B').playerId);
  });

  it('clears the identity mapping on leave — a session cannot outlive its verified identity', async () => {
    const token = mint({ playerId: 'p-leaving' });
    const claims = await room.onAuth(fakeClient('sess-1'), roomOptions(token));
    room.onJoin(fakeClient('sess-1'), roomOptions(token), claims);
    expect(room.resolvePlatformIdentity('sess-1').playerId).toBe('p-leaving');

    room.onLeave(fakeClient('sess-1'));
    // Falls back to the sessionId-based identity once no verified claims remain for this session.
    expect(room.resolvePlatformIdentity('sess-1').playerId).toBe('sess-1');
  });

  it('a room with no auth configured falls back to Colyseus default behavior (unit-test-only path, never used by the live server)', async () => {
    const unauthedRoom = new AdaptedGameRoom();
    stubListing(unauthedRoom);
    unauthedRoom.onCreate(roomOptions(undefined) as Types.RoomOptions);
    const result = await unauthedRoom.onAuth(fakeClient('sess-1'), roomOptions(undefined));
    expect(result).toBe(true);
  });
});
