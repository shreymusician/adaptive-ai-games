/**
 * End-to-end: plays a short real TOSIOS match entirely through this
 * package's public surface (event derivation + the Decision Adapter),
 * never reaching into GameState internals beyond what the adapter itself
 * uses. This is the closest thing Phase 10A has to "the full loop" without
 * a live Colyseus server (out of scope — see mission's PHASE 10D note and
 * this package's README "Status").
 */
import { describe, it, expect } from 'vitest';
import { TosiosEventDeriver } from '../event-deriver';
import { captureSnapshot } from '../snapshot';
import { getLegalActions, applyDecision } from '../decision-adapter';
import { buildRealGame, startRealMatch } from './fixtures';
import { Constants } from '../../vendor-dist/common/src';
import { TosiosCanonicalEvent } from '../event-mapping';

describe('integration — a short real match, driven entirely through the adapter surface', () => {
  it('derives a coherent event stream: MatchStarted, movement, combat, and never invents an action outside getLegalActions', () => {
    const handle = buildRealGame();
    const [p1, p2] = startRealMatch(handle, 2);
    handle.state.players.get(p1)!.setPosition(100, 100);
    handle.state.players.get(p2)!.setPosition(160, 100);

    const deriver = new TosiosEventDeriver();
    const allEvents: TosiosCanonicalEvent[] = [];

    // The 'start' message was already broadcast by startRealMatch's startGame() call, before the deriver existed — capture it explicitly here (mirrors how AdaptedGameRoom's handleMessage would have seen it live).
    for (const message of handle.messages) {
      allEvents.push(...deriver.captureMessage(message, 'small', 'deathmatch', 2, new Map([[handle.state.players.get(p1)!.name, p1], [handle.state.players.get(p2)!.name, p2]])));
    }
    deriver.diffTick(captureSnapshot(handle.state, 0)); // seed the tick-diff baseline

    let now = 100;
    let killed = false;
    for (let i = 0; i < 60 && !killed; i++) {
      now += 17;

      // Every action actually applied must have come from getLegalActions — the Decision Adapter never invents one.
      const legalP1 = getLegalActions(handle.state, p1, now, Constants.BULLET_RATE);
      const shootAction = legalP1.find((a) => a.id === 'shoot:nearestOpponent');
      if (shootAction) {
        // Mirrors AdaptedGameRoom's onCreate wildcard handler: observe the shoot attempt (AbilityUsed/AbilityOnCooldownAttempt) BEFORE the command reaches playerPushAction — see adapted-game-room.ts.
        const shooter = handle.state.players.get(p1)!;
        allEvents.push(deriver.observeShootAttempt(p1, shooter.lastShootAt, Constants.BULLET_RATE, shooter.rotation, now));
        applyDecision(handle.state, p1, shootAction, now);
      } else {
        const advance = legalP1.find((a) => a.id === 'move:towardNearestOpponent');
        if (advance) applyDecision(handle.state, p1, advance, now);
      }

      handle.state.update();
      allEvents.push(...deriver.diffTick(captureSnapshot(handle.state, now)));

      killed = handle.messages.some((m) => m.type === 'killed');
      if (killed) {
        const killedMsg = handle.messages.find((m) => m.type === 'killed')!;
        allEvents.push(
          ...deriver.captureMessage(killedMsg, 'small', 'deathmatch', 2, new Map([[handle.state.players.get(p1)!.name, p1], [handle.state.players.get(p2)!.name, p2]]))
        );
      }
    }

    expect(allEvents.some((e) => e.type === 'MatchStarted')).toBe(true);
    expect(allEvents.some((e) => e.type === 'AbilityUsed' && e.playerId === p1)).toBe(true);
    expect(allEvents.some((e) => e.type === 'PlayerDamaged' && e.playerId === p2)).toBe(true);

    // Every emitted event's action-adjacent playerId must be a real participant of this match — never a fabricated or foreign id.
    for (const e of allEvents) {
      if (e.playerId !== '') expect([p1, p2]).toContain(e.playerId);
    }
  });
});
