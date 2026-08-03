import { describe, it, expect } from 'vitest';
import { RoutePreferenceDetector } from '../../detectors/exploration/route-preference';
import { RoomClearingDetector } from '../../detectors/exploration/room-clearing';
import { ExplorationOrderDetector } from '../../detectors/exploration/exploration-order';
import { makeEvent, makeMatch, makeRunContext, runDetector } from '../fixtures';

describe('RoutePreferenceDetector', () => {
  it('unit: tallies exploration-context movement by routeId', () => {
    const events = [makeEvent({ type: 'PlayerMoved', payload: { context: 'exploration', routeId: 'east-path' } })];
    const result = runDetector(new RoutePreferenceDetector(), makeRunContext({ match: makeMatch() }), events);
    expect(result.deltas[0]).toMatchObject({ patternKey: 'east-path', opportunities: 1, matches: 1 });
  });

  it('boundary: escape-context movement does not count toward exploration route preference', () => {
    const result = runDetector(new RoutePreferenceDetector(), makeRunContext({ match: makeMatch() }), [makeEvent({ type: 'PlayerMoved', payload: { context: 'escape', routeId: 'x' } })]);
    expect(result.deltas).toHaveLength(0);
  });
});

describe('RoomClearingDetector', () => {
  it('unit: matched when roomFullyCleared is true', () => {
    const events = [makeEvent({ type: 'ItemPicked', payload: { roomFullyCleared: true } }), makeEvent({ type: 'ItemPicked', payload: { roomFullyCleared: false } })];
    const result = runDetector(new RoomClearingDetector(), makeRunContext({ match: makeMatch() }), events);
    expect(result.deltas[0]).toMatchObject({ opportunities: 2, matches: 1 });
  });

  it('boundary: events without roomFullyCleared are ignored', () => {
    const result = runDetector(new RoomClearingDetector(), makeRunContext({ match: makeMatch() }), [makeEvent({ type: 'ItemPicked', payload: {} })]);
    expect(result.deltas).toHaveLength(0);
  });
});

describe('ExplorationOrderDetector', () => {
  it('unit: casts exactly one vote for the FIRST areaId seen this match', () => {
    const events = [makeEvent({ type: 'PlayerMoved', payload: { areaId: 'forest' } }), makeEvent({ type: 'PlayerMoved', payload: { areaId: 'cave' } })];
    const result = runDetector(new ExplorationOrderDetector(), makeRunContext({ match: makeMatch() }), events);
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0]).toMatchObject({ patternKey: 'forest', opportunities: 1, matches: 1 });
  });

  it('boundary: no areaId anywhere in the match yields no deltas', () => {
    const result = runDetector(new ExplorationOrderDetector(), makeRunContext({ match: makeMatch() }), [makeEvent({ type: 'PlayerMoved', payload: {} })]);
    expect(result.deltas).toHaveLength(0);
  });
});
