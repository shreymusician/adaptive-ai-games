import { Action, EmitEventInput, isAction, isActionArray, isEmitEventInput } from './types';

/**
 * Every message this SDK sends carries this marker so both sides can
 * distinguish our traffic from unrelated postMessage activity (browser
 * extensions, other embedded content, etc.) sharing the same window.
 * Messages without it are ignored, never processed, on both ends.
 */
export const SDK_MESSAGE_CHANNEL = 'adaptive-ai-sdk/v1' as const;

// ---------------------------------------------------------------------------
// Client (plugin, untrusted) -> Host (platform, trusted)
// ---------------------------------------------------------------------------

export interface EmitMessage {
  channel: typeof SDK_MESSAGE_CHANNEL;
  kind: 'emit';
  seq: number;
  event: EmitEventInput;
}

export interface LegalActionsResponseMessage {
  channel: typeof SDK_MESSAGE_CHANNEL;
  kind: 'legalActionsResponse';
  requestId: string;
  entityId: string;
  actions: Action[];
}

export interface DecisionAckMessage {
  channel: typeof SDK_MESSAGE_CHANNEL;
  kind: 'decisionAck';
  requestId: string;
}

export type ClientToHostMessage = EmitMessage | LegalActionsResponseMessage | DecisionAckMessage;

// ---------------------------------------------------------------------------
// Host (platform, trusted) -> Client (plugin, untrusted)
// ---------------------------------------------------------------------------

export interface LegalActionsRequestMessage {
  channel: typeof SDK_MESSAGE_CHANNEL;
  kind: 'legalActionsRequest';
  requestId: string;
  entityId: string;
}

export interface SubmitDecisionMessage {
  channel: typeof SDK_MESSAGE_CHANNEL;
  kind: 'submitDecision';
  requestId: string;
  entityId: string;
  action: Action;
}

export type HostToClientMessage = LegalActionsRequestMessage | SubmitDecisionMessage;

// ---------------------------------------------------------------------------
// Runtime parsers — postMessage delivers `unknown`, never trust the static
// type alone. Every field is checked; malformed or foreign messages parse
// to `null` rather than throwing, so a stray unrelated postMessage on the
// same window never crashes either side.
// ---------------------------------------------------------------------------

const hasChannel = (value: unknown): value is { channel: unknown; kind: unknown } => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.channel === SDK_MESSAGE_CHANNEL && typeof v.kind === 'string';
};

export const parseClientToHostMessage = (data: unknown): ClientToHostMessage | null => {
  if (!hasChannel(data)) return null;
  const v = data as Record<string, unknown>;

  if (v.kind === 'emit') {
    if (typeof v.seq !== 'number' || !isEmitEventInput(v.event)) return null;
    return { channel: SDK_MESSAGE_CHANNEL, kind: 'emit', seq: v.seq, event: v.event };
  }

  if (v.kind === 'legalActionsResponse') {
    if (typeof v.requestId !== 'string' || typeof v.entityId !== 'string' || !isActionArray(v.actions)) {
      return null;
    }
    return {
      channel: SDK_MESSAGE_CHANNEL,
      kind: 'legalActionsResponse',
      requestId: v.requestId,
      entityId: v.entityId,
      actions: v.actions,
    };
  }

  if (v.kind === 'decisionAck') {
    if (typeof v.requestId !== 'string') return null;
    return { channel: SDK_MESSAGE_CHANNEL, kind: 'decisionAck', requestId: v.requestId };
  }

  return null;
};

export const parseHostToClientMessage = (data: unknown): HostToClientMessage | null => {
  if (!hasChannel(data)) return null;
  const v = data as Record<string, unknown>;

  if (v.kind === 'legalActionsRequest') {
    if (typeof v.requestId !== 'string' || typeof v.entityId !== 'string') return null;
    return { channel: SDK_MESSAGE_CHANNEL, kind: 'legalActionsRequest', requestId: v.requestId, entityId: v.entityId };
  }

  if (v.kind === 'submitDecision') {
    if (typeof v.requestId !== 'string' || typeof v.entityId !== 'string' || !isAction(v.action)) return null;
    return {
      channel: SDK_MESSAGE_CHANNEL,
      kind: 'submitDecision',
      requestId: v.requestId,
      entityId: v.entityId,
      action: v.action,
    };
  }

  return null;
};
