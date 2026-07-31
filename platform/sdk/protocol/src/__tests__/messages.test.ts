import { describe, expect, it } from 'vitest';
import { SDK_MESSAGE_CHANNEL, parseClientToHostMessage, parseHostToClientMessage } from '../messages';

describe('parseClientToHostMessage', () => {
  it('parses a valid emit message', () => {
    const raw = {
      channel: SDK_MESSAGE_CHANNEL,
      kind: 'emit',
      seq: 1,
      event: { type: 'PlayerMoved', payload: { x: 1, y: 2 } },
    };
    expect(parseClientToHostMessage(raw)).toEqual(raw);
  });

  it('parses a valid legalActionsResponse message', () => {
    const raw = {
      channel: SDK_MESSAGE_CHANNEL,
      kind: 'legalActionsResponse',
      requestId: 'r1',
      entityId: 'boss',
      actions: [{ id: 'attack' }],
    };
    expect(parseClientToHostMessage(raw)).toEqual(raw);
  });

  it('parses a valid decisionAck message', () => {
    const raw = { channel: SDK_MESSAGE_CHANNEL, kind: 'decisionAck', requestId: 'r1' };
    expect(parseClientToHostMessage(raw)).toEqual(raw);
  });

  it('rejects a message on the wrong channel — the defining defense against foreign postMessage traffic', () => {
    const raw = { channel: 'some-other-library', kind: 'emit', seq: 1, event: { type: 'PlayerMoved', payload: {} } };
    expect(parseClientToHostMessage(raw)).toBeNull();
  });

  it('rejects an unknown kind', () => {
    expect(parseClientToHostMessage({ channel: SDK_MESSAGE_CHANNEL, kind: 'somethingElse' })).toBeNull();
  });

  it('rejects an emit message with a malformed event', () => {
    const raw = { channel: SDK_MESSAGE_CHANNEL, kind: 'emit', seq: 1, event: { type: 'NotReal', payload: {} } };
    expect(parseClientToHostMessage(raw)).toBeNull();
  });

  it('rejects a legalActionsResponse with a malformed action in the array', () => {
    const raw = {
      channel: SDK_MESSAGE_CHANNEL,
      kind: 'legalActionsResponse',
      requestId: 'r1',
      entityId: 'boss',
      actions: [{ id: 'attack' }, { notAnAction: true }],
    };
    expect(parseClientToHostMessage(raw)).toBeNull();
  });

  it('never throws on garbage input', () => {
    expect(() => parseClientToHostMessage(undefined)).not.toThrow();
    expect(() => parseClientToHostMessage(null)).not.toThrow();
    expect(() => parseClientToHostMessage(42)).not.toThrow();
    expect(() => parseClientToHostMessage('hello')).not.toThrow();
    expect(() => parseClientToHostMessage([1, 2, 3])).not.toThrow();
    expect(parseClientToHostMessage(undefined)).toBeNull();
  });
});

describe('parseHostToClientMessage', () => {
  it('parses a valid legalActionsRequest message', () => {
    const raw = { channel: SDK_MESSAGE_CHANNEL, kind: 'legalActionsRequest', requestId: 'r1', entityId: 'boss' };
    expect(parseHostToClientMessage(raw)).toEqual(raw);
  });

  it('parses a valid submitDecision message', () => {
    const raw = {
      channel: SDK_MESSAGE_CHANNEL,
      kind: 'submitDecision',
      requestId: 'r1',
      entityId: 'boss',
      action: { id: 'attack', params: { target: 'p1' } },
    };
    expect(parseHostToClientMessage(raw)).toEqual(raw);
  });

  it('rejects a submitDecision with a malformed action', () => {
    const raw = { channel: SDK_MESSAGE_CHANNEL, kind: 'submitDecision', requestId: 'r1', entityId: 'boss', action: { id: '' } };
    expect(parseHostToClientMessage(raw)).toBeNull();
  });

  it('rejects a message on the wrong channel', () => {
    expect(
      parseHostToClientMessage({ channel: 'not-us', kind: 'legalActionsRequest', requestId: 'r1', entityId: 'boss' })
    ).toBeNull();
  });

  it('never throws on garbage input', () => {
    expect(() => parseHostToClientMessage({})).not.toThrow();
    expect(parseHostToClientMessage({})).toBeNull();
  });
});
