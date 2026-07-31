/**
 * Canonical event taxonomy — the platform-wide vocabulary every plugin's
 * events are expressed in. Extending this list is a deliberate, versioned
 * decision (see PLATFORM_V2_DESIGN.md §4), not something plugins do freely.
 */
export const CANONICAL_EVENT_TYPES = [
  'MatchStarted',
  'MatchEnded',
  'PlayerMoved',
  'PlayerDamaged',
  'PlayerDied',
  'AbilityUsed',
  'AbilityOnCooldownAttempt',
  'TargetAcquired',
  'TargetSwitched',
  'ItemPicked',
  'WeaponEquipped',
  'DecisionPoint',
] as const;

export type CanonicalEventType = (typeof CANONICAL_EVENT_TYPES)[number];

export const isCanonicalEventType = (value: unknown): value is CanonicalEventType =>
  typeof value === 'string' && (CANONICAL_EVENT_TYPES as readonly string[]).includes(value);

/**
 * What a plugin supplies when it calls sdk.emit(...). Deliberately excludes
 * playerId/gameId/matchId/schemaVersion/seq — the plugin's own code never
 * needs to know player identity, and the host stamps match context and
 * sequencing, since only the host has that information at mount time.
 */
export interface EmitEventInput {
  type: CanonicalEventType;
  payload: Record<string, unknown>;
  ts?: number;
}

export const isEmitEventInput = (value: unknown): value is EmitEventInput => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!isCanonicalEventType(v.type)) return false;
  if (typeof v.payload !== 'object' || v.payload === null) return false;
  if (v.ts !== undefined && typeof v.ts !== 'number') return false;
  return true;
};

/**
 * The fully-enriched event as it exists once the host has stamped match
 * context — this is what @adaptive-ai/event-pipeline persists (Phase 3).
 */
export interface CanonicalEvent {
  playerId: string;
  gameId: string;
  matchId: string;
  seq: number;
  ts: number;
  type: CanonicalEventType;
  payload: Record<string, unknown>;
  schemaVersion: string;
}

/**
 * A single action a plugin declares legal for a given entity at the moment
 * it's asked. `legalUntil`, when present, tells the Decision Engine the
 * action expires — so it can't be tricked into acting on stale information.
 */
export interface Action {
  id: string;
  params?: Record<string, unknown>;
  legalUntil?: number;
}

export const isAction = (value: unknown): value is Action => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (v.params !== undefined && (typeof v.params !== 'object' || v.params === null)) return false;
  if (v.legalUntil !== undefined && typeof v.legalUntil !== 'number') return false;
  return true;
};

export const isActionArray = (value: unknown): value is Action[] =>
  Array.isArray(value) && value.every(isAction);

/**
 * Static, declared-once metadata for a plugin — the third and final SDK
 * surface, alongside Events and Legal Actions.
 */
export interface GamePluginManifest {
  id: string;
  displayName: string;
  version: string;
  upstreamVersion: string;
  entryUrl: string;
  eventSchemaVersion: string;
  supportsAIOpponent: boolean;
  license: {
    spdxId: string;
    noticeUrl: string;
    upstreamRepo: string;
  };
  legalActionSpace: string;
}

export const isGamePluginManifest = (value: unknown): value is GamePluginManifest => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.displayName !== 'string') return false;
  if (typeof v.version !== 'string') return false;
  if (typeof v.upstreamVersion !== 'string') return false;
  if (typeof v.entryUrl !== 'string') return false;
  if (typeof v.eventSchemaVersion !== 'string') return false;
  if (typeof v.supportsAIOpponent !== 'boolean') return false;
  if (typeof v.legalActionSpace !== 'string') return false;
  if (typeof v.license !== 'object' || v.license === null) return false;
  const license = v.license as Record<string, unknown>;
  if (typeof license.spdxId !== 'string') return false;
  if (typeof license.noticeUrl !== 'string') return false;
  if (typeof license.upstreamRepo !== 'string') return false;
  return true;
};

/**
 * Known only to the host at mount time — the plugin's own code never sees
 * this. Stamped onto every event before it leaves the host, which is what
 * lets the plugin stay genuinely ignorant of player identity.
 */
export interface MatchContext {
  matchId: string;
  playerId: string;
  gameId: string;
  schemaVersion: string;
}

export const isMatchContext = (value: unknown): value is MatchContext => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.matchId === 'string' &&
    typeof v.playerId === 'string' &&
    typeof v.gameId === 'string' &&
    typeof v.schemaVersion === 'string'
  );
};
