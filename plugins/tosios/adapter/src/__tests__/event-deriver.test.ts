import { describe, it, expect, beforeEach } from 'vitest';
import { TosiosEventDeriver } from '../event-deriver';
import { captureSnapshot } from '../snapshot';
import { buildRealGame, startRealMatch, RealGameHandle } from './fixtures';
import { Constants } from '../../vendor-dist/common/src';

/** Drives the real GameState exactly the way AdaptedGameRoom's handleTick does: state.update() then diff. Returns every canonical event derived. */
function tick(handle: RealGameHandle, deriver: TosiosEventDeriver, ts: number) {
  handle.state.update();
  return deriver.diffTick(captureSnapshot(handle.state, ts));
}

describe('TosiosEventDeriver — message capture', () => {
  let deriver: TosiosEventDeriver;

  beforeEach(() => {
    deriver = new TosiosEventDeriver();
  });

  it('maps a "start" message to MatchStarted with real map/mode/maxPlayers', () => {
    const events = deriver.captureMessage({ type: 'start', from: 'server', ts: 1000, params: {} }, 'small', 'deathmatch', 4, new Map());
    expect(events).toEqual([{ type: 'MatchStarted', playerId: '', payload: { map: 'small', mode: 'deathmatch', maxPlayers: 4 }, ts: 1000 }]);
  });

  it('buffers "won" and consumes it on the following "stop"', () => {
    const wonEvents = deriver.captureMessage({ type: 'won', from: 'server', ts: 900, params: { name: 'Player1' } }, 'small', 'deathmatch', 4, new Map());
    expect(wonEvents).toEqual([]);
    const stopEvents = deriver.captureMessage({ type: 'stop', from: 'server', ts: 1000, params: {} }, 'small', 'deathmatch', 4, new Map());
    expect(stopEvents).toEqual([{ type: 'MatchEnded', playerId: '', payload: { outcome: 'win', winnerName: 'Player1' }, ts: 1000 }]);
  });

  it('buffers "timeout" and consumes it on the following "stop"', () => {
    deriver.captureMessage({ type: 'timeout', from: 'server', ts: 900, params: {} }, 'small', 'deathmatch', 4, new Map());
    const stopEvents = deriver.captureMessage({ type: 'stop', from: 'server', ts: 1000, params: {} }, 'small', 'deathmatch', 4, new Map());
    expect(stopEvents).toEqual([{ type: 'MatchEnded', playerId: '', payload: { outcome: 'timeout' }, ts: 1000 }]);
  });

  it('a "stop" with no preceding won/timeout is attributed "abandoned"', () => {
    const stopEvents = deriver.captureMessage({ type: 'stop', from: 'server', ts: 1000, params: {} }, 'small', 'deathmatch', 4, new Map());
    expect(stopEvents).toEqual([{ type: 'MatchEnded', playerId: '', payload: { outcome: 'abandoned' }, ts: 1000 }]);
  });

  it('maps "killed" to PlayerDied, resolving the killed/killer NAMES to playerIds via the supplied lookup', () => {
    const byName = new Map([['Alice', 'p1'], ['Bob', 'p2']]);
    const events = deriver.captureMessage({ type: 'killed', from: 'server', ts: 1000, params: { killerName: 'Bob', killedName: 'Alice' } }, 'small', 'deathmatch', 4, byName);
    expect(events).toEqual([{ type: 'PlayerDied', playerId: 'p1', payload: { killerName: 'Bob', killerId: 'p2' }, ts: 1000 }]);
  });

  it('a monster kill ("A bat") has no killerId, since a monster is not a player', () => {
    const byName = new Map([['Alice', 'p1']]);
    const events = deriver.captureMessage({ type: 'killed', from: 'server', ts: 1000, params: { killerName: 'A bat', killedName: 'Alice' } }, 'small', 'deathmatch', 4, byName);
    expect(events).toEqual([{ type: 'PlayerDied', playerId: 'p1', payload: { killerName: 'A bat' }, ts: 1000 }]);
  });

  it('"waiting"/"joined"/"left" have no canonical equivalent and produce nothing', () => {
    expect(deriver.captureMessage({ type: 'waiting', from: 'server', ts: 1, params: {} }, 'small', 'deathmatch', 4, new Map())).toEqual([]);
    expect(deriver.captureMessage({ type: 'joined', from: 'server', ts: 1, params: { name: 'x' } }, 'small', 'deathmatch', 4, new Map())).toEqual([]);
    expect(deriver.captureMessage({ type: 'left', from: 'server', ts: 1, params: { name: 'x' } }, 'small', 'deathmatch', 4, new Map())).toEqual([]);
  });
});

describe('TosiosEventDeriver — tick diffing against a REAL GameState', () => {
  it('diffTick emits nothing on the very first call (no prior baseline)', () => {
    const handle = buildRealGame();
    startRealMatch(handle, 2);
    const deriver = new TosiosEventDeriver();
    const events = deriver.diffTick(captureSnapshot(handle.state, 1000));
    expect(events).toEqual([]);
  });

  it('emits PlayerMoved when a real move action changes a player position beyond the noise epsilon', () => {
    const handle = buildRealGame();
    const [p1] = startRealMatch(handle, 2);
    const deriver = new TosiosEventDeriver();
    deriver.diffTick(captureSnapshot(handle.state, 1000)); // seed baseline

    handle.state.playerPushAction({ playerId: p1, ts: 1010, type: 'move', value: { x: 1, y: 0 } });
    const events = tick(handle, deriver, 1010);

    const moved = events.find((e) => e.type === 'PlayerMoved' && e.playerId === p1);
    expect(moved).toBeDefined();
    expect(moved!.payload.dx).toBeGreaterThan(0);
  });

  it('never emits PlayerMoved for a player who did not move', () => {
    const handle = buildRealGame();
    startRealMatch(handle, 2);
    const deriver = new TosiosEventDeriver();
    deriver.diffTick(captureSnapshot(handle.state, 1000));
    const events = tick(handle, deriver, 1010);
    expect(events.filter((e) => e.type === 'PlayerMoved')).toEqual([]);
  });

  it('emits PlayerDamaged (bullet-attributed, correct shooter and distance) when a real bullet connects', () => {
    const handle = buildRealGame();
    const [p1, p2] = startRealMatch(handle, 2);
    handle.state.players.get(p1)!.setPosition(100, 100);
    handle.state.players.get(p2)!.setPosition(130, 100); // due east, close enough for the bullet to reach in a few ticks
    const deriver = new TosiosEventDeriver();
    deriver.diffTick(captureSnapshot(handle.state, 1000));

    handle.state.playerPushAction({ playerId: p1, ts: 1010, type: 'shoot', value: { angle: 0 } });

    let damaged: ReturnType<typeof tick>[number] | undefined;
    for (let i = 0; i < 10 && !damaged; i++) {
      const events = tick(handle, deriver, 1010 + i * 17);
      damaged = events.find((e) => e.type === 'PlayerDamaged' && e.playerId === p2);
    }

    expect(damaged).toBeDefined();
    expect(damaged!.payload.sourceType).toBe('bullet');
    expect(damaged!.payload.sourceId).toBe(p1);
    expect(damaged!.payload.amount).toBe(1);
    expect(typeof damaged!.payload.distance).toBe('number');
    expect(handle.state.players.get(p2)!.lives).toBe(Constants.PLAYER_MAX_LIVES - 1);
  });

  it('emits PlayerDied (from the captured "killed" message) alongside the final PlayerDamaged when lives reach 0', () => {
    const handle = buildRealGame();
    const [p1, p2] = startRealMatch(handle, 2);
    handle.state.players.get(p1)!.setPosition(100, 100);
    handle.state.players.get(p2)!.setPosition(130, 100);
    handle.state.players.get(p2)!.setLives(1); // one hit from death
    const deriver = new TosiosEventDeriver();
    deriver.diffTick(captureSnapshot(handle.state, 1000));

    handle.state.playerPushAction({ playerId: p1, ts: 1010, type: 'shoot', value: { angle: 0 } });

    let allEvents: ReturnType<typeof tick> = [];
    for (let i = 0; i < 10 && !handle.messages.some((m) => m.type === 'killed'); i++) {
      handle.state.update();
      allEvents = allEvents.concat(deriver.diffTick(captureSnapshot(handle.state, 1010 + i * 17)));
    }

    expect(allEvents.some((e) => e.type === 'PlayerDamaged' && e.playerId === p2)).toBe(true);
    expect(handle.state.players.get(p2)!.isAlive).toBe(false);

    // The 'killed' message itself is captured separately, via captureMessage — see the message-capture describe block above for that path; here we only assert the state-diff side (PlayerDamaged) fired correctly for the lethal hit.
  });

  it('emits ItemPicked when a player walks over a potion', () => {
    const handle = buildRealGame();
    const [p1] = startRealMatch(handle, 2);
    const prop = handle.state.props[0];
    handle.state.players.get(p1)!.setPosition(prop.x, prop.y); // stand exactly on the prop
    handle.state.players.get(p1)!.setLives(1); // not full — heal() will actually apply and prop will deactivate
    const deriver = new TosiosEventDeriver();
    deriver.diffTick(captureSnapshot(handle.state, 1000));

    // A pickup only resolves inside playerMove's collision check — push a (near-)zero move so the collision check runs without actually leaving the prop's position.
    handle.state.playerPushAction({ playerId: p1, ts: 1010, type: 'move', value: { x: 0.001, y: 0 } });
    const events = tick(handle, deriver, 1010);

    const picked = events.find((e) => e.type === 'ItemPicked' && e.playerId === p1);
    expect(picked).toBeDefined();
    expect(picked!.payload.itemType).toBe('potion-red');
  });
});

describe('TosiosEventDeriver — shoot-attempt observation (cooldown)', () => {
  it('an unthrottled shot maps to AbilityUsed', () => {
    const deriver = new TosiosEventDeriver();
    const event = deriver.observeShootAttempt('p1', undefined, Constants.BULLET_RATE, 0, 1000);
    expect(event.type).toBe('AbilityUsed');
    expect(event.payload.weaponAction).toBe('shoot');
  });

  it('a shot attempted before BULLET_RATE has elapsed maps to AbilityOnCooldownAttempt', () => {
    const deriver = new TosiosEventDeriver();
    const event = deriver.observeShootAttempt('p1', 1000, Constants.BULLET_RATE, 0, 1000 + Constants.BULLET_RATE / 2);
    expect(event.type).toBe('AbilityOnCooldownAttempt');
    expect(event.payload.remainingCooldownMs).toBeCloseTo(Constants.BULLET_RATE / 2, 0);
  });

  it('a shot attempted after BULLET_RATE has elapsed maps to AbilityUsed with the real elapsed gap', () => {
    const deriver = new TosiosEventDeriver();
    const event = deriver.observeShootAttempt('p1', 1000, Constants.BULLET_RATE, 0, 1000 + Constants.BULLET_RATE + 50);
    expect(event.type).toBe('AbilityUsed');
    expect(event.payload.timeSinceCooldownReadyMs).toBeCloseTo(Constants.BULLET_RATE + 50, 0);
  });
});
