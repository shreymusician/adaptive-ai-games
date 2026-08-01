import { SDK_MESSAGE_CHANNEL } from '@adaptive-ai/sdk-protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GameSDK } from '../game-sdk';
import { FakeMessageTransport } from './fake-transport';

describe('GameSDK.emit', () => {
  let transport: FakeMessageTransport;
  let sdk: GameSDK;

  beforeEach(() => {
    transport = new FakeMessageTransport();
    sdk = new GameSDK(transport, 'https://platform.example');
    sdk.start();
    transport.simulateHandshakeAccepted();
  });

  it('posts a well-formed emit message for the given event', () => {
    sdk.emit({ type: 'PlayerMoved', payload: { x: 1, y: 2 } });

    expect(transport.sent).toHaveLength(2); // clientGreeting + emit
    expect(transport.sent[1]).toEqual({
      message: {
        channel: SDK_MESSAGE_CHANNEL,
        kind: 'emit',
        seq: 1,
        event: { type: 'PlayerMoved', payload: { x: 1, y: 2 } },
      },
      targetOrigin: 'https://platform.example',
    });
  });

  it('increments seq on every call, monotonically, starting at 1', () => {
    sdk.emit({ type: 'PlayerMoved', payload: {} });
    sdk.emit({ type: 'PlayerDamaged', payload: { amount: 5 } });
    sdk.emit({ type: 'PlayerDied', payload: {} });

    expect(transport.sent.slice(1).map((s) => (s.message as { seq: number }).seq)).toEqual([1, 2, 3]);
  });

  it('defaults targetOrigin to "*" when not specified', () => {
    const openSdk = new GameSDK(transport);
    openSdk.start();
    transport.simulateHandshakeAccepted();
    openSdk.emit({ type: 'PlayerMoved', payload: {} });
    expect(transport.sent[1].targetOrigin).toBe('*');
  });
});

describe('GameSDK.start / stop', () => {
  it('registers a listener on start and does not double-register on a second start', () => {
    const transport = new FakeMessageTransport();
    const sdk = new GameSDK(transport);
    sdk.start();
    sdk.start();
    expect(transport.listenerCount).toBe(1);
  });

  it('removes the listener on stop', () => {
    const transport = new FakeMessageTransport();
    const sdk = new GameSDK(transport);
    sdk.start();
    sdk.stop();
    expect(transport.listenerCount).toBe(0);
  });

  it('stop before start is a safe no-op', () => {
    const transport = new FakeMessageTransport();
    const sdk = new GameSDK(transport);
    expect(() => sdk.stop()).not.toThrow();
  });
});

describe('GameSDK legal actions request handling', () => {
  let transport: FakeMessageTransport;
  let sdk: GameSDK;

  beforeEach(() => {
    transport = new FakeMessageTransport();
    sdk = new GameSDK(transport, 'https://platform.example');
    sdk.start();
    transport.simulateHandshakeAccepted();
  });

  it('answers a legalActionsRequest by calling the registered provider and posting the result', () => {
    const provider = vi.fn().mockReturnValue([{ id: 'attack' }, { id: 'move' }]);
    sdk.onLegalActionsRequest(provider);

    transport.simulateIncoming({
      channel: SDK_MESSAGE_CHANNEL,
      kind: 'legalActionsRequest',
      requestId: 'req-1',
      entityId: 'boss-entity',
    });

    expect(provider).toHaveBeenCalledWith('boss-entity');
    expect(transport.sent).toContainEqual({
      message: {
        channel: SDK_MESSAGE_CHANNEL,
        kind: 'legalActionsResponse',
        requestId: 'req-1',
        entityId: 'boss-entity',
        actions: [{ id: 'attack' }, { id: 'move' }],
      },
      targetOrigin: 'https://platform.example',
    });
  });

  it('answers with an empty action list if no provider is registered, rather than staying silent', () => {
    transport.simulateIncoming({
      channel: SDK_MESSAGE_CHANNEL,
      kind: 'legalActionsRequest',
      requestId: 'req-2',
      entityId: 'boss-entity',
    });

    expect(transport.sent).toContainEqual({
      message: { channel: SDK_MESSAGE_CHANNEL, kind: 'legalActionsResponse', requestId: 'req-2', entityId: 'boss-entity', actions: [] },
      targetOrigin: 'https://platform.example',
    });
  });
});

describe('GameSDK decision handling', () => {
  let transport: FakeMessageTransport;
  let sdk: GameSDK;

  beforeEach(() => {
    transport = new FakeMessageTransport();
    sdk = new GameSDK(transport, 'https://platform.example');
    sdk.start();
    transport.simulateHandshakeAccepted();
  });

  it('invokes the registered decision handler and acknowledges receipt', () => {
    const handler = vi.fn();
    sdk.onDecision(handler);

    transport.simulateIncoming({
      channel: SDK_MESSAGE_CHANNEL,
      kind: 'submitDecision',
      requestId: 'req-3',
      entityId: 'boss-entity',
      action: { id: 'attack', params: { target: 'p1' } },
    });

    expect(handler).toHaveBeenCalledWith('boss-entity', { id: 'attack', params: { target: 'p1' } });
    expect(transport.sent).toContainEqual({
      message: { channel: SDK_MESSAGE_CHANNEL, kind: 'decisionAck', requestId: 'req-3' },
      targetOrigin: 'https://platform.example',
    });
  });

  it('still acknowledges even if no decision handler is registered, so the host is never left waiting', () => {
    transport.simulateIncoming({
      channel: SDK_MESSAGE_CHANNEL,
      kind: 'submitDecision',
      requestId: 'req-4',
      entityId: 'boss-entity',
      action: { id: 'attack' },
    });

    expect(transport.sent).toContainEqual({
      message: { channel: SDK_MESSAGE_CHANNEL, kind: 'decisionAck', requestId: 'req-4' },
      targetOrigin: 'https://platform.example',
    });
  });
});

describe('GameSDK robustness against foreign/malformed postMessage traffic', () => {
  it('ignores messages on a different channel without throwing or responding', () => {
    const transport = new FakeMessageTransport();
    const sdk = new GameSDK(transport);
    sdk.start();

    const beforeCount = transport.sent.length; // capture greeting count
    expect(() =>
      transport.simulateIncoming({ channel: 'some-browser-extension', kind: 'legalActionsRequest', requestId: 'x', entityId: 'y' })
    ).not.toThrow();
    expect(transport.sent).toHaveLength(beforeCount); // no response to foreign channel
  });

  it('ignores completely unrelated message shapes', () => {
    const transport = new FakeMessageTransport();
    const sdk = new GameSDK(transport);
    sdk.start();

    const beforeCount = transport.sent.length; // capture greeting count
    expect(() => transport.simulateIncoming('just a string')).not.toThrow();
    expect(() => transport.simulateIncoming(null)).not.toThrow();
    expect(() => transport.simulateIncoming({ unrelated: true })).not.toThrow();
    expect(transport.sent).toHaveLength(beforeCount); // no response to garbage
  });
});
