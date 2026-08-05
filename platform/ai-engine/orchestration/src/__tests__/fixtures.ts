/** Raw (pre-CanonicalEvent) event shape a plugin would POST in a batch request. */
export interface RawBatchEvent {
  seq: number;
  type: string;
  payload: Record<string, unknown>;
  ts: number;
}

/**
 * A full, realistic MatchStarted -> gameplay -> MatchEnded event sequence
 * for one match, in the exact shape POST /api/events/batch expects. Covers
 * enough signal to trigger several Player Modeling analyzers (Aggression,
 * Reaction Time, Risk Tolerance, Exploration, Preferred Combat Distance) and
 * several Pattern Recognition detectors (Dodge Direction, Weapon
 * Preference, Target Prioritization) in a single match, so an end-to-end
 * test can assert real, non-empty output from every stage.
 */
export function buildMatchEvents(baseTs: number): RawBatchEvent[] {
  let seq = 1;
  let ts = baseTs;
  const events: RawBatchEvent[] = [];
  const push = (type: string, payload: Record<string, unknown>) => {
    events.push({ seq: seq++, type, payload, ts: ts++ });
  };

  push('MatchStarted', { mapId: 'arena-1' });

  push('WeaponEquipped', { weaponId: 'rifle' });

  // Dodge direction — three "left" dodges, one "right" (categorical signal).
  push('PlayerMoved', { action: 'dodge', direction: 'left' });
  push('PlayerMoved', { action: 'dodge', direction: 'left' });
  push('PlayerMoved', { action: 'dodge', direction: 'left' });
  push('PlayerMoved', { action: 'dodge', direction: 'right' });

  // Exploration signal.
  push('PlayerMoved', { context: 'exploration', routeId: 'north-corridor', areaId: 'zone-2' });

  // Combat: offensive ability uses + target acquisitions -> Aggression, Target Prioritization.
  push('TargetAcquired', { targetType: 'enemy' });
  push('AbilityUsed', { abilityType: 'attack', offensive: true, weaponAction: 'shoot' });
  push('AbilityUsed', { abilityType: 'attack', offensive: true, weaponAction: 'shoot' });
  push('TargetAcquired', { targetType: 'enemy' });
  push('AbilityUsed', { abilityType: 'attack', offensive: true, weaponAction: 'reload' });

  // Preferred engagement distance + risk signal.
  push('PlayerDamaged', { distance: 8, dangerLevel: 0.7 });

  // Reaction Time — enough decision points with an explicit reactionMs to
  // clear the analyzer's per-match evidence gate (minMatchConfidence 0.2,
  // k=5 -> needs >=2-3 samples for asymptoticConfidence to clear it).
  push('DecisionPoint', { chosenAction: 'attack', reactionMs: 240 });
  push('DecisionPoint', { chosenAction: 'attack', reactionMs: 310 });
  push('DecisionPoint', { chosenAction: 'retreat', reactionMs: 180 });

  push('MatchEnded', { outcome: 'win', durationMs: ts - baseTs });

  return events;
}

/** A minimal single-event batch, useful for tests that only care about MatchStarted or MatchEnded in isolation. */
export function singleEventBatch(seq: number, type: string, payload: Record<string, unknown>, ts: number): RawBatchEvent[] {
  return [{ seq, type, payload, ts }];
}
