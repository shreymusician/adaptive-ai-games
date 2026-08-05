/**
 * PlanCache — in-process, per-match plan caching, incremental replanning,
 * invalidation, and goal interruption. Same "plain in-process Map, no
 * database" convention as Memory Engine's WorkingMemoryStore (this is
 * exactly analogous ephemeral, match-scoped state — a StrategicIntent is
 * never itself the durable record of anything; if it needs to be persisted
 * for Explainability, that is a future caller's concern, not this cache's).
 *
 * A cached plan remains valid — and is reused as-is (`cacheHit: true`,
 * `replanned: false`) — only while ALL of the following hold:
 *   1. Its TTL (config.goap.planTtlMs) has not elapsed.
 *   2. The current AbstractWorldState fingerprint is unchanged.
 *   3. The awareness budget is unchanged.
 *   4. The personality is unchanged.
 *   5. No higher-interruptPriority goal has newly become eligible (see
 *      `findInterruptingGoal` below) — this is "goal interruption":
 *      Retreat (interruptPriority 10) must be able to preempt an
 *      in-progress multi-step plan the instant the AI's own health drops,
 *      never waiting for the cached plan's natural TTL.
 *
 * Any single failed condition triggers a full replan (`cacheHit: false`) —
 * this IS "incremental replanning": most planning calls in a stable
 * situation are a cheap cache hit; a full GOAP search only runs when
 * something in the world actually changed.
 */

import { GoalRegistry } from './registry';
import { AbstractWorldState, GoalCandidateTrace, PersonalityArchetype, StrategicIntent } from './types';
import { fingerprintFacts } from './stats';

export interface CachedPlanEntry {
  intent: StrategicIntent;
  worldStateFingerprint: string;
  awarenessBudget: number;
  personality: PersonalityArchetype;
  createdAt: number;
  /** goalIds with interruptPriority > 0 that were ELIGIBLE at the moment this plan was created — the baseline `findInterruptingGoal` compares the next call against, so an interrupt-capable goal that was ALREADY eligible (and simply stayed eligible) never re-triggers a replan on every subsequent call. */
  eligibleInterruptGoalIds: string[];
}

export class PlanCache {
  private readonly entries = new Map<string, CachedPlanEntry>();

  get(matchId: string): CachedPlanEntry | undefined {
    return this.entries.get(matchId);
  }

  set(matchId: string, entry: CachedPlanEntry): void {
    this.entries.set(matchId, entry);
  }

  invalidate(matchId: string): boolean {
    return this.entries.delete(matchId);
  }

  clear(): void {
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }
}

export function fingerprintWorldState(worldState: AbstractWorldState): string {
  return fingerprintFacts(worldState);
}

export interface CacheValidity {
  valid: boolean;
  reason: 'ttl_expired' | 'world_state_changed' | 'awareness_budget_changed' | 'personality_changed' | 'valid';
}

export function checkCacheValidity(entry: CachedPlanEntry, now: number, worldStateFingerprint: string, awarenessBudget: number, personality: PersonalityArchetype, planTtlMs: number): CacheValidity {
  if (now - entry.createdAt >= planTtlMs) return { valid: false, reason: 'ttl_expired' };
  if (entry.worldStateFingerprint !== worldStateFingerprint) return { valid: false, reason: 'world_state_changed' };
  if (entry.awarenessBudget !== awarenessBudget) return { valid: false, reason: 'awareness_budget_changed' };
  if (entry.personality !== personality) return { valid: false, reason: 'personality_changed' };
  return { valid: true, reason: 'valid' };
}

/** Every currently-eligible goal id with a positive interruptPriority — stored on a cache entry at creation time as the baseline for the NEXT call's interruption check. */
export function eligibleInterruptGoalIds(registry: GoalRegistry, rootCandidates: GoalCandidateTrace[]): string[] {
  return rootCandidates.filter((c) => c.preconditionsMet && (registry.get(c.goalId)?.interruptPriority ?? 0) > 0).map((c) => c.goalId);
}

/**
 * Returns the highest-`interruptPriority` eligible goal that was NOT
 * already eligible when the cached plan was created, or null if none
 * qualifies. This is a genuine STATE TRANSITION check, not merely "is
 * eligible and isn't the active goal" — an interrupt-capable goal that was
 * already eligible on the previous call (and simply remains eligible) must
 * never force a replan on every single subsequent call; that would defeat
 * incremental replanning entirely. It only counts as an interruption the
 * moment it newly becomes eligible (e.g. health just dropped below the
 * Retreat threshold) compared to `previouslyEligibleIds`.
 */
export function findInterruptingGoal(registry: GoalRegistry, rootCandidates: GoalCandidateTrace[], previouslyEligibleIds: ReadonlySet<string>): string | null {
  let best: { goalId: string; priority: number } | null = null;
  for (const candidate of rootCandidates) {
    if (!candidate.preconditionsMet) continue;
    if (previouslyEligibleIds.has(candidate.goalId)) continue;
    const meta = registry.get(candidate.goalId);
    if (!meta || meta.interruptPriority <= 0) continue;
    if (best === null || meta.interruptPriority > best.priority) {
      best = { goalId: candidate.goalId, priority: meta.interruptPriority };
    }
  }
  return best?.goalId ?? null;
}
