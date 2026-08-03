import { describe, it, expect } from 'vitest';
import { PushAfterDamageDetector } from '../../detectors/risk/push-after-damage';
import { ChaseLowHealthDetector } from '../../detectors/risk/chase-low-health';
import { OverextensionDetector } from '../../detectors/risk/overextension';
import { makeEvent, makeMatch, makeRunContext, runDetector } from '../fixtures';

describe('PushAfterDamageDetector', () => {
  it('unit: matched when an aggressive follow-up appears within the look-ahead window', () => {
    const events = [makeEvent({ type: 'PlayerDamaged' }), makeEvent({ type: 'TargetAcquired' })];
    const match = makeMatch({ recentEvents: events });
    const result = runDetector(new PushAfterDamageDetector(), makeRunContext({ match }), events);
    expect(result.deltas[0]).toMatchObject({ opportunities: 1, matches: 1 });
  });

  it('unit: not matched when the player disengages (no aggressive follow-up in the window)', () => {
    const events = [makeEvent({ type: 'PlayerDamaged' }), makeEvent({ type: 'PlayerMoved', payload: { context: 'escape' } })];
    const match = makeMatch({ recentEvents: events });
    const result = runDetector(new PushAfterDamageDetector(), makeRunContext({ match }), events);
    expect(result.deltas[0]).toMatchObject({ opportunities: 1, matches: 0 });
  });

  it('boundary: no PlayerDamaged events at all yields no deltas', () => {
    const match = makeMatch({ recentEvents: [] });
    const result = runDetector(new PushAfterDamageDetector(), makeRunContext({ match }), []);
    expect(result.deltas).toHaveLength(0);
  });
});

describe('ChaseLowHealthDetector', () => {
  it('unit: matched when the acquired target is at/below the low-health threshold', () => {
    const events = [makeEvent({ type: 'TargetAcquired', payload: { targetHealthPercent: 0.1 } }), makeEvent({ type: 'TargetAcquired', payload: { targetHealthPercent: 0.9 } })];
    const result = runDetector(new ChaseLowHealthDetector(), makeRunContext({ match: makeMatch() }), events);
    expect(result.deltas[0]).toMatchObject({ opportunities: 2, matches: 1 });
  });

  it('boundary: events without targetHealthPercent are ignored', () => {
    const result = runDetector(new ChaseLowHealthDetector(), makeRunContext({ match: makeMatch() }), [makeEvent({ type: 'TargetAcquired', payload: {} })]);
    expect(result.deltas).toHaveLength(0);
  });
});

describe('OverextensionDetector', () => {
  it('unit: matched when isolationLevel is at/above the overextension threshold', () => {
    const events = [makeEvent({ type: 'PlayerMoved', payload: { isolationLevel: 0.9 } }), makeEvent({ type: 'PlayerMoved', payload: { isolationLevel: 0.1 } })];
    const result = runDetector(new OverextensionDetector(), makeRunContext({ match: makeMatch() }), events);
    expect(result.deltas[0]).toMatchObject({ opportunities: 2, matches: 1 });
  });

  it('boundary: events without isolationLevel are ignored', () => {
    const result = runDetector(new OverextensionDetector(), makeRunContext({ match: makeMatch() }), [makeEvent({ type: 'PlayerMoved', payload: {} })]);
    expect(result.deltas).toHaveLength(0);
  });
});
