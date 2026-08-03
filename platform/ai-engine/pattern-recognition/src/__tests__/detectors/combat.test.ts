import { describe, it, expect } from 'vitest';
import { ReloadTimingDetector } from '../../detectors/combat/reload-timing';
import { TargetPrioritizationDetector } from '../../detectors/combat/target-prioritization';
import { EngagementDistanceDetector } from '../../detectors/combat/engagement-distance';
import { WeaponPreferenceDetector } from '../../detectors/combat/weapon-preference';
import { makeConfig, makeEvent, makeMatch, makeRunContext, runDetector } from '../fixtures';

describe('ReloadTimingDetector', () => {
  it('unit: buckets reloads by shots-fired-since-last-reload', () => {
    const events = [
      makeEvent({ type: 'AbilityUsed', payload: { weaponAction: 'shoot' } }),
      makeEvent({ type: 'AbilityUsed', payload: { weaponAction: 'shoot' } }),
      makeEvent({ type: 'AbilityUsed', payload: { weaponAction: 'reload' } }),
      makeEvent({ type: 'AbilityUsed', payload: { weaponAction: 'shoot' } }),
      makeEvent({ type: 'AbilityUsed', payload: { weaponAction: 'reload' } }),
    ];
    const result = runDetector(new ReloadTimingDetector(), makeRunContext({ match: makeMatch() }), events);
    const twoShots = result.deltas.find((d) => d.patternKey === 'after-2-shots')!;
    const oneShot = result.deltas.find((d) => d.patternKey === 'after-1-shots')!;
    expect(twoShots.matches).toBe(1);
    expect(oneShot.matches).toBe(1);
  });

  it('boundary: no reload events yields no deltas', () => {
    const result = runDetector(new ReloadTimingDetector(), makeRunContext({ match: makeMatch() }), [makeEvent({ type: 'AbilityUsed', payload: { weaponAction: 'shoot' } })]);
    expect(result.deltas).toHaveLength(0);
  });
});

describe('TargetPrioritizationDetector', () => {
  it('unit: tallies target acquisitions by targetType', () => {
    const events = [makeEvent({ type: 'TargetAcquired', payload: { targetType: 'healer' } })];
    const result = runDetector(new TargetPrioritizationDetector(), makeRunContext({ match: makeMatch() }), events);
    expect(result.deltas[0]).toMatchObject({ patternKey: 'healer', opportunities: 1, matches: 1 });
  });

  it('boundary: a TargetAcquired event with no targetType is ignored', () => {
    const result = runDetector(new TargetPrioritizationDetector(), makeRunContext({ match: makeMatch() }), [makeEvent({ type: 'TargetAcquired', payload: {} })]);
    expect(result.deltas).toHaveLength(0);
  });
});

describe('EngagementDistanceDetector', () => {
  it('unit: buckets PlayerDamaged distance into close/mid/long', () => {
    const events = [makeEvent({ type: 'PlayerDamaged', payload: { distance: 3 } }), makeEvent({ type: 'PlayerDamaged', payload: { distance: 30 } })];
    const result = runDetector(new EngagementDistanceDetector(), makeRunContext({ match: makeMatch(), settings: makeConfig() }), events);
    expect(result.deltas.find((d) => d.patternKey === 'close')).toBeDefined();
    expect(result.deltas.find((d) => d.patternKey === 'long')).toBeDefined();
  });

  it('boundary: events without a numeric distance are ignored', () => {
    const result = runDetector(new EngagementDistanceDetector(), makeRunContext({ match: makeMatch() }), [makeEvent({ type: 'PlayerDamaged', payload: {} })]);
    expect(result.deltas).toHaveLength(0);
  });
});

describe('WeaponPreferenceDetector', () => {
  it('unit: tallies WeaponEquipped events by weaponId', () => {
    const events = [makeEvent({ type: 'WeaponEquipped', payload: { weaponId: 'bow' } })];
    const result = runDetector(new WeaponPreferenceDetector(), makeRunContext({ match: makeMatch() }), events);
    expect(result.deltas[0]).toMatchObject({ patternKey: 'bow', opportunities: 1, matches: 1 });
  });

  it('boundary: non-WeaponEquipped events are ignored', () => {
    const result = runDetector(new WeaponPreferenceDetector(), makeRunContext({ match: makeMatch() }), [makeEvent({ type: 'ItemPicked', payload: { weaponId: 'bow' } })]);
    expect(result.deltas).toHaveLength(0);
  });
});
