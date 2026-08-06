import { describe, it, expect } from 'vitest';
import { getLegalActions, applyDecision } from '../decision-adapter';
import { buildRealGame, startRealMatch } from './fixtures';
import { Constants } from '../../vendor-dist/common/src';

describe('getLegalActions — against a REAL GameState', () => {
  it('returns [] before the match has started (game.state !== "game")', () => {
    const handle = buildRealGame();
    handle.state.playerAdd('p1', 'Player1');
    expect(getLegalActions(handle.state, 'p1', 0, Constants.BULLET_RATE)).toEqual([]);
  });

  it('returns [] for a dead player', () => {
    const handle = buildRealGame();
    const [p1] = startRealMatch(handle, 2);
    handle.state.players.get(p1)!.setLives(0);
    expect(getLegalActions(handle.state, p1, 0, Constants.BULLET_RATE)).toEqual([]);
  });

  it('returns [] for a playerId not present in this room', () => {
    const handle = buildRealGame();
    startRealMatch(handle, 2);
    expect(getLegalActions(handle.state, 'ghost', 0, Constants.BULLET_RATE)).toEqual([]);
  });

  it('always includes hold + all 8 compass moves for a live player with no opponent', () => {
    const handle = buildRealGame();
    handle.state.playerAdd('p1', 'Player1');
    // `Game.state` is a real public field — force it directly to 'game' with only one player present (so no opponent exists for offensive actions), without waiting through the real lobby flow that requires >1 player. `playerAdd` alone leaves lives at 0 (real match-start, which this bypasses, is what normally calls setPlayersActive(true)) — set it directly too, same reason.
    handle.state.game.state = 'game';
    handle.state.players.get('p1')!.setLives(Constants.PLAYER_MAX_LIVES);
    const actions = getLegalActions(handle.state, 'p1', 0, Constants.BULLET_RATE);
    const ids = actions.map((a) => a.id);
    expect(ids).toContain('hold');
    for (const dir of ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']) expect(ids).toContain(`move:${dir}`);
    expect(ids).not.toContain('shoot:nearestOpponent');
    expect(ids).not.toContain('move:towardNearestOpponent');
  });

  it('adds advance/retreat/shoot when a live opponent exists and the player is off cooldown', () => {
    const handle = buildRealGame();
    const [p1] = startRealMatch(handle, 2);
    const actions = getLegalActions(handle.state, p1, 0, Constants.BULLET_RATE);
    const ids = actions.map((a) => a.id);
    expect(ids).toContain('move:towardNearestOpponent');
    expect(ids).toContain('move:awayFromNearestOpponent');
    expect(ids).toContain('shoot:nearestOpponent');
  });

  it('omits shoot when the player is still on cooldown', () => {
    const handle = buildRealGame();
    const [p1] = startRealMatch(handle, 2);
    handle.state.players.get(p1)!.lastShootAt = 1000;
    const ids = getLegalActions(handle.state, p1, 1000 + Constants.BULLET_RATE / 2, Constants.BULLET_RATE).map((a) => a.id);
    expect(ids).not.toContain('shoot:nearestOpponent');
  });

  it('a teammate is never targeted in team deathmatch', () => {
    const handle = buildRealGame('team deathmatch', 4);
    const [p1, p2] = startRealMatch(handle, 2);
    handle.state.players.get(p1)!.setTeam('Red');
    handle.state.players.get(p2)!.setTeam('Red');
    const ids = getLegalActions(handle.state, p1, 0, Constants.BULLET_RATE).map((a) => a.id);
    expect(ids).not.toContain('shoot:nearestOpponent');
    expect(ids).not.toContain('move:towardNearestOpponent');
  });

  it('every returned action has a legalUntil in the future', () => {
    const handle = buildRealGame();
    const [p1] = startRealMatch(handle, 2);
    const now = 5000;
    for (const action of getLegalActions(handle.state, p1, now, Constants.BULLET_RATE)) {
      expect(action.legalUntil).toBeGreaterThan(now);
    }
  });
});

describe('applyDecision — calls ONLY the real, public playerPushAction, never mutates state directly', () => {
  it('"hold" issues no command at all', () => {
    const handle = buildRealGame();
    const [p1] = startRealMatch(handle, 2);
    const before = { x: handle.state.players.get(p1)!.x, y: handle.state.players.get(p1)!.y };
    const applied = applyDecision(handle.state, p1, { id: 'hold' }, 0);
    expect(applied).toEqual([]);
    handle.state.update();
    expect(handle.state.players.get(p1)!.x).toBe(before.x);
    expect(handle.state.players.get(p1)!.y).toBe(before.y);
  });

  it('"move:N" pushes a rotate then a move action, and the player actually moves north after the next tick', () => {
    const handle = buildRealGame();
    const [p1] = startRealMatch(handle, 2);
    handle.state.players.get(p1)!.setPosition(500, 500);
    const before = handle.state.players.get(p1)!.y;

    const applied = applyDecision(handle.state, p1, { id: 'move:N' }, 0);
    expect(applied.map((a) => a.type)).toEqual(['rotate', 'move']);

    handle.state.update();
    expect(handle.state.players.get(p1)!.y).toBeLessThan(before); // N = negative y
  });

  it('"move:towardNearestOpponent" moves the player closer to the real nearest opponent', () => {
    const handle = buildRealGame();
    const [p1, p2] = startRealMatch(handle, 2);
    handle.state.players.get(p1)!.setPosition(100, 100);
    handle.state.players.get(p2)!.setPosition(300, 100);
    const before = Math.hypot(300 - 100, 0);

    applyDecision(handle.state, p1, { id: 'move:towardNearestOpponent' }, 0);
    handle.state.update();

    const after = Math.hypot(handle.state.players.get(p2)!.x - handle.state.players.get(p1)!.x, handle.state.players.get(p2)!.y - handle.state.players.get(p1)!.y);
    expect(after).toBeLessThan(before);
  });

  it('"shoot:nearestOpponent" pushes rotate + shoot, and a real bullet spawns aimed at the opponent', () => {
    const handle = buildRealGame();
    const [p1, p2] = startRealMatch(handle, 2);
    handle.state.players.get(p1)!.setPosition(100, 100);
    handle.state.players.get(p2)!.setPosition(300, 100);

    const applied = applyDecision(handle.state, p1, { id: 'shoot:nearestOpponent' }, 0);
    expect(applied.map((a) => a.type)).toEqual(['rotate', 'shoot']);

    handle.state.update();
    expect(handle.state.bullets.length).toBeGreaterThan(0);
    expect(handle.state.bullets[0].playerId).toBe(p1);
  });

  it('an unrecognized action id is a no-op, never a fallback guess', () => {
    const handle = buildRealGame();
    const [p1] = startRealMatch(handle, 2);
    const before = { x: handle.state.players.get(p1)!.x, y: handle.state.players.get(p1)!.y };
    const applied = applyDecision(handle.state, p1, { id: 'do-something-fabricated' }, 0);
    expect(applied).toEqual([]);
    handle.state.update();
    expect(handle.state.players.get(p1)!.x).toBe(before.x);
    expect(handle.state.players.get(p1)!.y).toBe(before.y);
  });

  it('a dead player never has a decision applied to them', () => {
    const handle = buildRealGame();
    const [p1] = startRealMatch(handle, 2);
    handle.state.players.get(p1)!.setLives(0);
    const applied = applyDecision(handle.state, p1, { id: 'move:N' }, 0);
    expect(applied).toEqual([]);
  });
});
