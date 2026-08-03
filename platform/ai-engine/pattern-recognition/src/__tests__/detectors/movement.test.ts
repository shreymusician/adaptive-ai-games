import { describe, it, expect } from 'vitest';
import { DodgeDirectionDetector } from '../../detectors/movement/dodge-direction';
import { EscapeRoutesDetector } from '../../detectors/movement/escape-routes';
import { CornerPreferenceDetector } from '../../detectors/movement/corner-preference';
import { CircleStrafingDetector } from '../../detectors/movement/circle-strafing';
import { makeEvent, makeMatch, makeRunContext, runDetector } from '../fixtures';

describe('DodgeDirectionDetector', () => {
  it('unit: tallies dodge events by direction, sharing the total across categories', () => {
    const events = [
      makeEvent({ type: 'PlayerMoved', payload: { action: 'dodge', direction: 'left' } }),
      makeEvent({ type: 'PlayerMoved', payload: { action: 'dodge', direction: 'left' } }),
      makeEvent({ type: 'PlayerMoved', payload: { action: 'dodge', direction: 'right' } }),
    ];
    const result = runDetector(new DodgeDirectionDetector(), makeRunContext({ match: makeMatch() }), events);
    const left = result.deltas.find((d) => d.patternKey === 'left')!;
    expect(left).toMatchObject({ opportunities: 3, matches: 2 });
  });

  it('boundary: non-dodge movement is ignored', () => {
    const result = runDetector(new DodgeDirectionDetector(), makeRunContext({ match: makeMatch() }), [makeEvent({ type: 'PlayerMoved', payload: { action: 'walk' } })]);
    expect(result.deltas).toHaveLength(0);
  });
});

describe('EscapeRoutesDetector', () => {
  it('unit: tallies escape-context movement by routeId', () => {
    const events = [makeEvent({ type: 'PlayerMoved', payload: { context: 'escape', routeId: 'north-corridor' } })];
    const result = runDetector(new EscapeRoutesDetector(), makeRunContext({ match: makeMatch() }), events);
    expect(result.deltas[0]).toMatchObject({ patternKey: 'north-corridor', opportunities: 1, matches: 1 });
  });

  it('boundary: movement outside escape context is ignored', () => {
    const result = runDetector(new EscapeRoutesDetector(), makeRunContext({ match: makeMatch() }), [makeEvent({ type: 'PlayerMoved', payload: { context: 'exploration', routeId: 'x' } })]);
    expect(result.deltas).toHaveLength(0);
  });
});

describe('CornerPreferenceDetector', () => {
  it('unit: tallies corner visits by cornerId', () => {
    const events = [makeEvent({ type: 'PlayerMoved', payload: { nearCorner: true, cornerId: 'nw' } })];
    const result = runDetector(new CornerPreferenceDetector(), makeRunContext({ match: makeMatch() }), events);
    expect(result.deltas[0]).toMatchObject({ patternKey: 'nw', opportunities: 1, matches: 1 });
  });

  it('boundary: movement not near a corner is ignored', () => {
    const result = runDetector(new CornerPreferenceDetector(), makeRunContext({ match: makeMatch() }), [makeEvent({ type: 'PlayerMoved', payload: {} })]);
    expect(result.deltas).toHaveLength(0);
  });
});

describe('CircleStrafingDetector', () => {
  it('unit: matched when strafing during combat', () => {
    const events = [makeEvent({ type: 'PlayerMoved', payload: { inCombat: true, strafing: true } }), makeEvent({ type: 'PlayerMoved', payload: { inCombat: true, strafing: false } })];
    const result = runDetector(new CircleStrafingDetector(), makeRunContext({ match: makeMatch() }), events);
    expect(result.deltas[0]).toMatchObject({ patternKey: 'circle-strafes', opportunities: 2, matches: 1 });
  });

  it('boundary: movement outside combat is not an opportunity', () => {
    const result = runDetector(new CircleStrafingDetector(), makeRunContext({ match: makeMatch() }), [makeEvent({ type: 'PlayerMoved', payload: { inCombat: false, strafing: true } })]);
    expect(result.deltas).toHaveLength(0);
  });
});
