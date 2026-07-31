import {
  Action,
  EmitEventInput,
  HostToClientMessage,
  parseHostToClientMessage,
  SDK_MESSAGE_CHANNEL,
} from '@adaptive-ai/sdk-protocol';
import { MessageTransport } from './transport';

/**
 * Supplied by the plugin: given an entity the platform wants to act through,
 * return every action currently legal for it. Called synchronously — a
 * plugin's own game state is always available to itself instantly, there is
 * no reason for this to be async.
 */
export type LegalActionsProvider = (entityId: string) => Action[];

/**
 * Supplied by the plugin: receive a decision the platform has made for an
 * entity and apply it through the plugin's own normal input-handling path —
 * the same path a human player's input would take.
 */
export type DecisionHandler = (entityId: string, action: Action) => void;

/**
 * The three-surface contract a game plugin is given, and nothing else.
 * Rendering, physics, and the plugin's actual game logic never touch this
 * class — they stay entirely inside the plugin's own code.
 */
export class GameSDK {
  private seq = 0;
  private legalActionsProvider: LegalActionsProvider | null = null;
  private decisionHandler: DecisionHandler | null = null;
  private started = false;

  constructor(
    private readonly transport: MessageTransport,
    private readonly targetOrigin: string = '*'
  ) {}

  /** Events API — one-directional, plugin to platform. */
  emit(input: EmitEventInput): void {
    this.seq += 1;
    this.transport.postMessage(
      { channel: SDK_MESSAGE_CHANNEL, kind: 'emit', seq: this.seq, event: input },
      this.targetOrigin
    );
  }

  /** Legal Actions API — the platform queries this, the plugin answers. */
  onLegalActionsRequest(provider: LegalActionsProvider): void {
    this.legalActionsProvider = provider;
  }

  /** The platform tells the plugin what an AI-controlled entity decided. */
  onDecision(handler: DecisionHandler): void {
    this.decisionHandler = handler;
  }

  /** Begin listening for messages from the platform. Idempotent. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.transport.addEventListener('message', this.handleIncoming);
  }

  /** Stop listening — releases the transport's event listener. */
  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.transport.removeEventListener('message', this.handleIncoming);
  }

  private readonly handleIncoming = (event: MessageEvent): void => {
    const message: HostToClientMessage | null = parseHostToClientMessage(event.data);
    if (!message) return; // foreign or malformed traffic on this window — ignore, never throw

    if (message.kind === 'legalActionsRequest') {
      const actions = this.legalActionsProvider ? this.legalActionsProvider(message.entityId) : [];
      this.transport.postMessage(
        {
          channel: SDK_MESSAGE_CHANNEL,
          kind: 'legalActionsResponse',
          requestId: message.requestId,
          entityId: message.entityId,
          actions,
        },
        this.targetOrigin
      );
      return;
    }

    if (message.kind === 'submitDecision') {
      this.decisionHandler?.(message.entityId, message.action);
      this.transport.postMessage(
        { channel: SDK_MESSAGE_CHANNEL, kind: 'decisionAck', requestId: message.requestId },
        this.targetOrigin
      );
    }
  };
}
