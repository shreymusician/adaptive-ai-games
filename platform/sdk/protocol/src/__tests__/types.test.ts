import { describe, expect, it } from 'vitest';
import { isAction, isActionArray, isEmitEventInput, isGamePluginManifest, isMatchContext } from '../types';

describe('isEmitEventInput', () => {
  it('accepts a minimal valid event', () => {
    expect(isEmitEventInput({ type: 'PlayerMoved', payload: {} })).toBe(true);
  });

  it('accepts an event with an explicit timestamp', () => {
    expect(isEmitEventInput({ type: 'PlayerDamaged', payload: { amount: 10 }, ts: 123 })).toBe(true);
  });

  it('rejects an unknown event type', () => {
    expect(isEmitEventInput({ type: 'PlayerTeleportedIllegally', payload: {} })).toBe(false);
  });

  it('rejects a missing payload', () => {
    expect(isEmitEventInput({ type: 'PlayerMoved' })).toBe(false);
  });

  it('rejects a non-numeric ts', () => {
    expect(isEmitEventInput({ type: 'PlayerMoved', payload: {}, ts: 'now' })).toBe(false);
  });

  it('rejects non-objects', () => {
    expect(isEmitEventInput(null)).toBe(false);
    expect(isEmitEventInput('PlayerMoved')).toBe(false);
    expect(isEmitEventInput(42)).toBe(false);
  });
});

describe('isAction', () => {
  it('accepts a minimal valid action', () => {
    expect(isAction({ id: 'move' })).toBe(true);
  });

  it('accepts an action with params and legalUntil', () => {
    expect(isAction({ id: 'useAbility:beam', params: { target: 'e1' }, legalUntil: 1000 })).toBe(true);
  });

  it('rejects an empty id', () => {
    expect(isAction({ id: '' })).toBe(false);
  });

  it('rejects a missing id', () => {
    expect(isAction({ params: {} })).toBe(false);
  });

  it('rejects a non-numeric legalUntil', () => {
    expect(isAction({ id: 'move', legalUntil: 'soon' })).toBe(false);
  });
});

describe('isActionArray', () => {
  it('accepts an empty array', () => {
    expect(isActionArray([])).toBe(true);
  });

  it('accepts an array of valid actions', () => {
    expect(isActionArray([{ id: 'move' }, { id: 'attack' }])).toBe(true);
  });

  it('rejects an array containing an invalid entry', () => {
    expect(isActionArray([{ id: 'move' }, { params: {} }])).toBe(false);
  });

  it('rejects a non-array', () => {
    expect(isActionArray({ id: 'move' })).toBe(false);
  });
});

describe('isGamePluginManifest', () => {
  const valid = {
    id: 'tosios',
    displayName: 'TOSIOS',
    version: '1.0.0',
    upstreamVersion: 'abc123',
    entryUrl: '/plugins/tosios/index.html',
    eventSchemaVersion: '1',
    supportsAIOpponent: true,
    license: { spdxId: 'MIT', noticeUrl: '/NOTICES#tosios', upstreamRepo: 'https://github.com/halftheopposite/TOSIOS' },
    legalActionSpace: 'tosios-v1',
  };

  it('accepts a complete, valid manifest', () => {
    expect(isGamePluginManifest(valid)).toBe(true);
  });

  it('rejects a manifest missing a required top-level field', () => {
    const { supportsAIOpponent: _drop, ...withoutFlag } = valid;
    expect(isGamePluginManifest(withoutFlag)).toBe(false);
  });

  it('rejects a manifest with a malformed license object', () => {
    expect(isGamePluginManifest({ ...valid, license: { spdxId: 'MIT' } })).toBe(false);
  });

  it('rejects a manifest where supportsAIOpponent is not boolean', () => {
    expect(isGamePluginManifest({ ...valid, supportsAIOpponent: 'yes' })).toBe(false);
  });
});

describe('isMatchContext', () => {
  it('accepts a valid match context', () => {
    expect(isMatchContext({ matchId: 'm1', playerId: 'p1', gameId: 'tosios', schemaVersion: '1' })).toBe(true);
  });

  it('rejects a context missing playerId', () => {
    expect(isMatchContext({ matchId: 'm1', gameId: 'tosios', schemaVersion: '1' })).toBe(false);
  });
});
