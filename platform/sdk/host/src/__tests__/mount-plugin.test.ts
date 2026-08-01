import { SDK_MESSAGE_CHANNEL, MatchContext } from '@adaptive-ai/sdk-protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountPlugin, MountedPlugin, PluginRequestTimeoutError } from '../index';
import { FakeHostTransport } from './fake-transport';

const matchContext: MatchContext = {
  matchId: 'match-1',
  playerId: 'player-1',
  gameId: 'dummy-game',
  schemaVersion: '1',
};

describe('mountPlugin emit relay', () => {
  let transport: FakeHostTransport;
  let onEvent: ReturnType<typeof vi.fn>;
  let plugin: MountedPlugin;

  beforeEach(() => {
    transport = new FakeHostTransport();
    onEvent = vi.fn();
    plugin = mountPlugin({ transport, matchContext, onEvent, targetOrigin: 'https://plugin.example' });
    // Complete handshake
    transport.simulateIncoming({
      channel: SDK_MESSAGE_CHANNEL,
      kind: 'clientGreeting',
      sdkVersion: '0.1.0',
      requestedSchemaVersion: '1',
    });
  });

  it('stamps match context onto an emitted event and forwards it to onEvent', () => {
    transport.simulateIncoming({
      channel: SDK_MESSAGE_CHANNEL,
      kind: 'emit',
      seq: 1,
      event: { type: 'PlayerMoved', payload: { x: 1, y: 2 }, ts: 12345 },
    });

    expect(onEvent).toHaveBeenCalledWith({
      playerId: 'player-1',
      gameId: 'dummy-game',
      matchId: 'match-1',
      schemaVersion: '1',
      seq: 1,
      ts: 12345,
      type: 'PlayerMoved',
      payload: { x: 1, y: 2 },
    });
  });

  it('defaults ts to now when the plugin does not supply one', () => {
    const before = Date.now();
    transport.simulateIncoming({
      channel: SDK_MESSAGE_CHANNEL,
      kind: 'emit',
      seq: 1,
      event: { type: 'PlayerMoved', payload: {} },
    });
    const after = Date.now();

    const stamped = onEvent.mock.calls[0][0];
    expect(stamped.ts).toBeGreaterThanOrEqual(before);
    expect(stamped.ts).toBeLessThanOrEqual(after);
  });

  it('never touches player identity fields the plugin itself never had access to', () => {
    transport.simulateIncoming({
      channel: SDK_MESSAGE_CHANNEL,
      kind: 'emit',
      seq: 1,
      event: { type: 'PlayerMoved', payload: { playerId: 'spoofed' } },
    });

    const stamped = onEvent.mock.calls[0][0];
    expect(stamped.playerId).toBe('player-1');
  });

  it('ignores foreign/malformed traffic without throwing or calling onEvent', () => {
    expect(() => transport.simulateIncoming({ channel: 'other-lib', kind: 'emit' })).not.toThrow();
    expect(() => transport.simulateIncoming('garbage')).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
  });
});

describe('mountPlugin.requestLegalActions', () => {
  let transport: FakeHostTransport;
  let plugin: MountedPlugin;

  beforeEach(() => {
    transport = new FakeHostTransport();
    plugin = mountPlugin({ transport, matchContext, onEvent: vi.fn(), targetOrigin: 'https://plugin.example' });
    // Complete handshake
    transport.simulateIncoming({
      channel: SDK_MESSAGE_CHANNEL,
      kind: 'clientGreeting',
      sdkVersion: '0.1.0',
      requestedSchemaVersion: '1',
    });
  });

  it('sends a legalActionsRequest and resolves with the actions from the matching response', async () => {
    const resultPromise = plugin.requestLegalActions('boss-entity');

    expect(transport.sent).toHaveLength(2); // hostGreeting + legalActionsRequest
    expect(transport.sent[1]).toEqual({
      message: { channel: SDK_MESSAGE_CHANNEL, kind: 'legalActionsRequest', requestId: transport.lastRequestId(), entityId: 'boss-entity' },
      targetOrigin: 'https://plugin.example',
    });

    transport.simulateIncoming({
      channel: SDK_MESSAGE_CHANNEL,
      kind: 'legalActionsResponse',
      requestId: transport.lastRequestId(),
      entityId: 'boss-entity',
      actions: [{ id: 'attack' }],
    });

    await expect(resultPromise).resolves.toEqual([{ id: 'attack' }]);
  });

  it('rejects with PluginRequestTimeoutError if the plugin never responds', async () => {
    vi.useFakeTimers();
    const resultPromise = plugin.requestLegalActions('boss-entity');
    const assertion = expect(resultPromise).rejects.toBeInstanceOf(PluginRequestTimeoutError);
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
    vi.useRealTimers();
  });

  it('ignores a legalActionsResponse for an unknown/already-settled requestId', () => {
    expect(() =>
      transport.simulateIncoming({
        channel: SDK_MESSAGE_CHANNEL,
        kind: 'legalActionsResponse',
        requestId: 'not-a-real-request',
        entityId: 'boss-entity',
        actions: [],
      })
    ).not.toThrow();
  });
});

describe('mountPlugin.submitDecision', () => {
  let transport: FakeHostTransport;
  let plugin: MountedPlugin;

  beforeEach(() => {
    transport = new FakeHostTransport();
    plugin = mountPlugin({ transport, matchContext, onEvent: vi.fn(), targetOrigin: 'https://plugin.example' });
    // Complete handshake
    transport.simulateIncoming({
      channel: SDK_MESSAGE_CHANNEL,
      kind: 'clientGreeting',
      sdkVersion: '0.1.0',
      requestedSchemaVersion: '1',
    });
  });

  it('sends submitDecision and resolves once the plugin acknowledges', async () => {
    const resultPromise = plugin.submitDecision('boss-entity', { id: 'attack', params: { target: 'p1' } });

    expect(transport.sent[1]).toEqual({
      message: {
        channel: SDK_MESSAGE_CHANNEL,
        kind: 'submitDecision',
        requestId: transport.lastRequestId(),
        entityId: 'boss-entity',
        action: { id: 'attack', params: { target: 'p1' } },
      },
      targetOrigin: 'https://plugin.example',
    });

    transport.simulateIncoming({
      channel: SDK_MESSAGE_CHANNEL,
      kind: 'decisionAck',
      requestId: transport.lastRequestId(),
    });

    await expect(resultPromise).resolves.toBeUndefined();
  });

  it('rejects with PluginRequestTimeoutError if never acknowledged', async () => {
    vi.useFakeTimers();
    const resultPromise = plugin.submitDecision('boss-entity', { id: 'attack' });
    const assertion = expect(resultPromise).rejects.toBeInstanceOf(PluginRequestTimeoutError);
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
    vi.useRealTimers();
  });
});

describe('mountPlugin.unmount', () => {
  it('removes the transport listener', () => {
    const transport = new FakeHostTransport();
    const plugin = mountPlugin({ transport, matchContext, onEvent: vi.fn() });
    expect(transport.listenerCount).toBe(1);
    plugin.unmount();
    expect(transport.listenerCount).toBe(0);
  });

  it('rejects in-flight requests rather than leaving them pending forever', async () => {
    const transport = new FakeHostTransport();
    const plugin = mountPlugin({ transport, matchContext, onEvent: vi.fn() });
    const pending = plugin.requestLegalActions('boss-entity');
    plugin.unmount();
    await expect(pending).rejects.toThrow('Plugin unmounted before responding');
  });

  it('rejects new requests made after unmount', async () => {
    const transport = new FakeHostTransport();
    const plugin = mountPlugin({ transport, matchContext, onEvent: vi.fn() });
    plugin.unmount();
    await expect(plugin.requestLegalActions('boss-entity')).rejects.toThrow('after unmount');
  });
});
