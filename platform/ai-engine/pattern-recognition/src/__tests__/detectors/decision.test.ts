import { describe, it, expect } from 'vitest';
import { RetreatConditionsDetector } from '../../detectors/decision/retreat-conditions';
import { HealingTimingDetector } from '../../detectors/decision/healing-timing';
import { AbilityUsageTimingDetector } from '../../detectors/decision/ability-usage-timing';
import { ResourceConservationDetector } from '../../detectors/decision/resource-conservation';
import { makeDecision, makeEvent, makeMatch, makeRunContext, runDetector } from '../fixtures';

describe('RetreatConditionsDetector', () => {
  it('unit: buckets retreat decisions by health band', () => {
    const match = makeMatch({ recentDecisions: [makeDecision({ chosenAction: 'retreat', context: { healthPercent: 0.15 } })] });
    const result = runDetector(new RetreatConditionsDetector(), makeRunContext({ match }));
    expect(result.deltas[0].patternKey).toBe('below-20');
  });

  it('boundary: non-retreat decisions are ignored', () => {
    const match = makeMatch({ recentDecisions: [makeDecision({ chosenAction: 'attack', context: { healthPercent: 0.1 } })] });
    const result = runDetector(new RetreatConditionsDetector(), makeRunContext({ match }));
    expect(result.deltas).toHaveLength(0);
  });
});

describe('HealingTimingDetector', () => {
  it('unit: buckets heal casts by the caster\'s own health band', () => {
    const events = [makeEvent({ type: 'AbilityUsed', payload: { abilityType: 'heal', healthPercent: 0.35 } })];
    const result = runDetector(new HealingTimingDetector(), makeRunContext({ match: makeMatch() }), events);
    expect(result.deltas[0].patternKey).toBe('20-40');
  });

  it('boundary: non-heal ability uses are ignored', () => {
    const result = runDetector(new HealingTimingDetector(), makeRunContext({ match: makeMatch() }), [makeEvent({ type: 'AbilityUsed', payload: { abilityType: 'attack', healthPercent: 0.3 } })]);
    expect(result.deltas).toHaveLength(0);
  });
});

describe('AbilityUsageTimingDetector', () => {
  it('unit: matched when fired within the immediate-usage window', () => {
    const events = [makeEvent({ type: 'AbilityUsed', payload: { timeSinceCooldownReadyMs: 50 } }), makeEvent({ type: 'AbilityUsed', payload: { timeSinceCooldownReadyMs: 5000 } })];
    const result = runDetector(new AbilityUsageTimingDetector(), makeRunContext({ match: makeMatch() }), events);
    expect(result.deltas[0]).toMatchObject({ opportunities: 2, matches: 1 });
  });

  it('boundary: events without timeSinceCooldownReadyMs are ignored', () => {
    const result = runDetector(new AbilityUsageTimingDetector(), makeRunContext({ match: makeMatch() }), [makeEvent({ type: 'AbilityUsed', payload: {} })]);
    expect(result.deltas).toHaveLength(0);
  });
});

describe('ResourceConservationDetector', () => {
  it('unit: matched when resourceCostRatio is at/below the conserving threshold', () => {
    const events = [makeEvent({ type: 'AbilityUsed', payload: { resourceCostRatio: 0.1 } }), makeEvent({ type: 'AbilityUsed', payload: { resourceCostRatio: 0.9 } })];
    const result = runDetector(new ResourceConservationDetector(), makeRunContext({ match: makeMatch() }), events);
    expect(result.deltas[0]).toMatchObject({ opportunities: 2, matches: 1 });
  });

  it('boundary: events without resourceCostRatio are ignored', () => {
    const result = runDetector(new ResourceConservationDetector(), makeRunContext({ match: makeMatch() }), [makeEvent({ type: 'AbilityUsed', payload: {} })]);
    expect(result.deltas).toHaveLength(0);
  });
});
