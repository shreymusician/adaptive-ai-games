import {
  Action,
  CanonicalEvent,
  ClientToHostMessage,
  HostToClientMessage,
  MatchContext,
  parseClientToHostMessage,
  SDK_MESSAGE_CHANNEL,
  SDK_VERSION,
  isCompatibleSdkVersion,
} from '@adaptive-ai/sdk-protocol';
import { HostTransport } from './transport';

export { HostTransport, WindowHostTransport } from './transport';
export { loadManifest, validateManifest } from './manifest-loader';
export type { IframeLoadOptions } from './plugin-iframe';
export { createPluginIframe, destroyPluginIframe } from './plugin-iframe';

/** Raised when a plugin doesn't answer a request within its timeout — the
 *  "last known good decision" fallback (PLATFORM_V2_DESIGN.md §11) is the
 *  caller's responsibility to apply; this class just signals the round-trip
 *  never completed so the caller isn't left awaiting forever. */
export class PluginRequestTimeoutError extends Error {
  constructor(kind: 'legalActionsRequest' | 'submitDecision', requestId: string) {
    super(`Plugin did not respond to ${kind} (requestId=${requestId}) in time`);
    this.name = 'PluginRequestTimeoutError';
  }
}

export interface MountPluginOptions {
  transport: HostTransport;
  /** Stamped onto every event a plugin emits — the plugin's own code never
   *  supplies or sees this, only the host knows it at mount time. */
  matchContext: MatchContext;
  /** Called for every well-formed event the plugin emits, already stamped
   *  with match context — hand this to @adaptive-ai/event-pipeline. */
  onEvent: (event: CanonicalEvent) => void;
  /** Origin to restrict outgoing postMessage calls to. Defaults to '*' for
   *  local/dev flexibility — pass the real plugin origin in production. */
  targetOrigin?: string;
  /** How long to wait for a plugin's response before rejecting. */
  requestTimeoutMs?: number;
  /** Called once the handshake with the plugin completes. */
  onHandshakeDone?: () => void;
  /** Called if the handshake is rejected (version mismatch, etc.). */
  onHandshakeRejected?: (reason: string) => void;
}

export interface MountedPlugin {
  /** Ask the plugin for every action currently legal for this entity. */
  requestLegalActions(entityId: string): Promise<Action[]>;
  /** Tell the plugin what the Decision Engine chose for this entity. Resolves
   *  once the plugin acknowledges having applied it. */
  submitDecision(entityId: string, action: Action): Promise<void>;
  /** Stop listening and reject any requests still in flight. */
  unmount(): void;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 2000;

let requestCounter = 0;
const nextRequestId = (): string => {
  requestCounter += 1;
  return `req-${requestCounter}-${Date.now()}`;
};

/**
 * Mounts a single plugin: the host-side half of the fairness boundary
 * (PLATFORM_V2_DESIGN.md §3.3). Relays `emit()` calls out to `onEvent`,
 * stamped with match context the plugin never sees, and exposes
 * `requestLegalActions`/`submitDecision` as promise-based round-trips over
 * the injected transport — no other call shape exists on this bridge.
 */
export function mountPlugin(options: MountPluginOptions): MountedPlugin {
  const { transport, matchContext, onEvent, targetOrigin = '*', requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, onHandshakeDone, onHandshakeRejected } = options;

  const pendingLegalActions = new Map<string, { resolve: (actions: Action[]) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const pendingDecisions = new Map<string, { resolve: () => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  let mounted = true;
  let handshakeDone = false;

  const handleMessage = (event: MessageEvent): void => {
    const message: ClientToHostMessage | null = parseClientToHostMessage(event.data);
    if (!message) return; // foreign or malformed traffic sharing this window — ignore, never throw

    if (message.kind === 'clientGreeting') {
      if (!isCompatibleSdkVersion(message.sdkVersion, SDK_VERSION)) {
        const reason = `SDK version mismatch: client=${message.sdkVersion}, host=${SDK_VERSION}`;
        send({
          channel: SDK_MESSAGE_CHANNEL,
          kind: 'hostGreeting',
          accepted: false,
          reason,
          sdkVersion: SDK_VERSION,
        });
        onHandshakeRejected?.(reason);
        return;
      }
      handshakeDone = true;
      send({
        channel: SDK_MESSAGE_CHANNEL,
        kind: 'hostGreeting',
        accepted: true,
        agreedSchemaVersion: matchContext.schemaVersion,
        sdkVersion: SDK_VERSION,
      });
      onHandshakeDone?.();
      return;
    }

    if (!handshakeDone) return; // ignore all other messages until handshake is done

    if (message.kind === 'emit') {
      const canonicalEvent: CanonicalEvent = {
        playerId: matchContext.playerId,
        gameId: matchContext.gameId,
        matchId: matchContext.matchId,
        schemaVersion: matchContext.schemaVersion,
        seq: message.seq,
        ts: message.event.ts ?? Date.now(),
        type: message.event.type,
        payload: message.event.payload,
      };
      onEvent(canonicalEvent);
      return;
    }

    if (message.kind === 'legalActionsResponse') {
      const pending = pendingLegalActions.get(message.requestId);
      if (!pending) return; // no longer awaited — timed out, or unmount already settled it
      pendingLegalActions.delete(message.requestId);
      clearTimeout(pending.timer);
      pending.resolve(message.actions);
      return;
    }

    if (message.kind === 'decisionAck') {
      const pending = pendingDecisions.get(message.requestId);
      if (!pending) return;
      pendingDecisions.delete(message.requestId);
      clearTimeout(pending.timer);
      pending.resolve();
    }
  };

  transport.onMessageFromPlugin(handleMessage);

  const send = (message: HostToClientMessage): void => {
    transport.postToPlugin(message, targetOrigin);
  };

  return {
    requestLegalActions(entityId: string): Promise<Action[]> {
      if (!mounted) return Promise.reject(new Error('Cannot requestLegalActions after unmount'));
      const requestId = nextRequestId();
      return new Promise<Action[]>((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingLegalActions.delete(requestId);
          reject(new PluginRequestTimeoutError('legalActionsRequest', requestId));
        }, requestTimeoutMs);
        pendingLegalActions.set(requestId, { resolve, reject, timer });
        send({ channel: SDK_MESSAGE_CHANNEL, kind: 'legalActionsRequest', requestId, entityId });
      });
    },

    submitDecision(entityId: string, action: Action): Promise<void> {
      if (!mounted) return Promise.reject(new Error('Cannot submitDecision after unmount'));
      const requestId = nextRequestId();
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingDecisions.delete(requestId);
          reject(new PluginRequestTimeoutError('submitDecision', requestId));
        }, requestTimeoutMs);
        pendingDecisions.set(requestId, { resolve, reject, timer });
        send({ channel: SDK_MESSAGE_CHANNEL, kind: 'submitDecision', requestId, entityId, action });
      });
    },

    unmount(): void {
      if (!mounted) return;
      mounted = false;
      transport.offMessageFromPlugin(handleMessage);
      for (const [, pending] of pendingLegalActions) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Plugin unmounted before responding'));
      }
      pendingLegalActions.clear();
      for (const [, pending] of pendingDecisions) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Plugin unmounted before responding'));
      }
      pendingDecisions.clear();
    },
  };
}
