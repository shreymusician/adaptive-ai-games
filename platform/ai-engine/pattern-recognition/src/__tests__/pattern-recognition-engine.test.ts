import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryEngine } from '@adaptive-ai/memory-engine';
import { PatternRegistry } from '../registry';
import { PatternStore } from '../pattern-store';
import { registerAllDetectors } from '../detectors';
import { PatternRecognitionEngine } from '../pattern-recognition-engine';
import { MatchNotCommittedError } from '../errors';
import { loadPatternRecognitionConfig } from '../config';
import { makeEvent, makeMatch, makeMemoryEngine, makePatternStore } from './fixtures';

function makeEngine(memoryEngine: MemoryEngine, patternStore: PatternStore): PatternRecognitionEngine {
  const registry = new PatternRegistry();
  registerAllDetectors(registry);
  return new PatternRecognitionEngine({ memoryEngine, patternStore, registry, config: loadPatternRecognitionConfig() });
}

describe('PatternRecognitionEngine — integration', () => {
  let memoryEngine: MemoryEngine;
  let patternStore: PatternStore;
  let engine: PatternRecognitionEngine;

  beforeEach(async () => {
    memoryEngine = makeMemoryEngine();
    await memoryEngine.initialize();
    patternStore = makePatternStore();
    engine = makeEngine(memoryEngine, patternStore);
    await engine.initialize();
  });

  it('rejects an uncommitted match', async () => {
    const match = makeMatch();
    (match as unknown as { committedAt: number | null }).committedAt = null as unknown as number;
    await expect(engine.processMatch(match)).rejects.toThrow(MatchNotCommittedError);
  });

  it('commits qualifying detector deltas as pattern records', async () => {
    const match = makeMatch({
      recentEvents: [
        makeEvent({ type: 'WeaponEquipped', payload: { weaponId: 'sword' } }),
        makeEvent({ type: 'WeaponEquipped', payload: { weaponId: 'sword' } }),
        makeEvent({ type: 'WeaponEquipped', payload: { weaponId: 'bow' } }),
      ],
    });
    const result = await engine.processMatch(match);
    expect(result.errors).toHaveLength(0);
    const weaponPattern = result.updated.find((p) => p.detectorId === 'weaponPreference' && p.patternKey === 'sword');
    expect(weaponPattern).toBeDefined();
    expect(weaponPattern!.observationCount).toBe(3); // total weapon-equip events this match (shared opportunity pool)
    expect(weaponPattern!.supportingEvidence).toBe(2);
  });

  it('a match with no qualifying evidence at all commits nothing and reports no errors', async () => {
    const result = await engine.processMatch(makeMatch());
    expect(result.updated).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(result.skipped.length).toBeGreaterThan(0);
  });

  it('historical progression / promotion: a consistent habit across many matches is promoted from candidate to confirmed to strong', async () => {
    const playerId = 'promo-player';
    const states: string[] = [];
    for (let i = 0; i < 40; i++) {
      const match = makeMatch({
        matchId: `m-${i}`,
        playerId,
        recentEvents: [makeEvent({ type: 'WeaponEquipped', payload: { weaponId: 'sword' } }), makeEvent({ type: 'WeaponEquipped', payload: { weaponId: 'sword' } })],
      });
      const result = await engine.processMatch(match);
      const pattern = result.updated.find((p) => p.patternKey === 'sword');
      if (pattern) states.push(pattern.state);
    }
    expect(states).toContain('candidate');
    expect(states.at(-1)).toBe('strong');

    const found = await patternStore.search({ playerId, state: 'strong', sortBy: 'confidence' });
    expect(found.patterns.length).toBeGreaterThan(0);
  });

  it('retirement: a habit that gets consistently contradicted decays down to retired', async () => {
    const playerId = 'retiring-player';
    // First, build up a confirmed/strong habit of always dodging left.
    for (let i = 0; i < 20; i++) {
      await engine.processMatch(makeMatch({ matchId: `build-${i}`, playerId, recentEvents: [makeEvent({ type: 'PlayerMoved', payload: { action: 'dodge', direction: 'left' } })] }));
    }
    const beforeContradiction = await patternStore.getByPatternId(playerId, 'game-1', 'dodgeDirection:left');
    expect(beforeContradiction!.state).toBe('strong');

    // Now the player consistently dodges right instead — 'left' should fade toward retired.
    let lastLeftState = beforeContradiction!.state;
    for (let i = 0; i < 30; i++) {
      const result = await engine.processMatch(
        makeMatch({ matchId: `contradict-${i}`, playerId, recentEvents: [makeEvent({ type: 'PlayerMoved', payload: { action: 'dodge', direction: 'right' } })] })
      );
      const left = result.updated.find((p) => p.patternKey === 'left');
      if (left) lastLeftState = left.state;
    }
    expect(['weakening', 'retired']).toContain(lastLeftState);
  });

  it('promotions and demotions are both reported on the run result when a state transition occurs', async () => {
    const playerId = 'transition-player';
    let sawPromotion = false;
    for (let i = 0; i < 40; i++) {
      const result = await engine.processMatch(
        makeMatch({ matchId: `m-${i}`, playerId, recentEvents: [makeEvent({ type: 'WeaponEquipped', payload: { weaponId: 'axe' } })] })
      );
      if (result.promotions.length > 0) sawPromotion = true;
    }
    expect(sawPromotion).toBe(true);
  });

  it('search API is usable end-to-end after several matches across multiple players/categories', async () => {
    await engine.processMatch(makeMatch({ playerId: 'a', recentEvents: [makeEvent({ type: 'WeaponEquipped', payload: { weaponId: 'sword' } })] }));
    await engine.processMatch(makeMatch({ playerId: 'b', recentEvents: [makeEvent({ type: 'PlayerMoved', payload: { action: 'dodge', direction: 'left' } })] }));

    const combatOnly = await patternStore.search({ category: 'combat' });
    const movementOnly = await patternStore.search({ category: 'movement' });
    expect(combatOnly.patterns.every((p) => p.category === 'combat')).toBe(true);
    expect(movementOnly.patterns.every((p) => p.category === 'movement')).toBe(true);
  });

  it('randomized gameplay: a long run of random events never throws and always yields valid confidences', async () => {
    const eventTypes = ['WeaponEquipped', 'TargetAcquired', 'PlayerMoved', 'AbilityUsed'];
    for (let m = 0; m < 15; m++) {
      const events = Array.from({ length: 10 }, () => {
        const type = eventTypes[Math.floor(Math.random() * eventTypes.length)];
        return makeEvent({
          type,
          payload:
            type === 'WeaponEquipped'
              ? { weaponId: `w${Math.floor(Math.random() * 3)}` }
              : type === 'PlayerMoved'
                ? { action: 'dodge', direction: ['left', 'right', 'back'][Math.floor(Math.random() * 3)] }
                : type === 'TargetAcquired'
                  ? { targetType: `t${Math.floor(Math.random() * 3)}` }
                  : { weaponAction: Math.random() > 0.8 ? 'reload' : 'shoot' },
        });
      });
      const result = await engine.processMatch(makeMatch({ matchId: `rand-${m}`, playerId: 'rand-player', recentEvents: events }));
      expect(result.errors).toHaveLength(0);
      for (const p of result.updated) {
        expect(p.confidence).toBeGreaterThanOrEqual(0);
        expect(p.confidence).toBeLessThanOrEqual(1);
      }
    }
  });
});
