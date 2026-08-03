import { WorkingMemoryConfig } from './config';
import { WorkingMemoryNotFoundError } from './errors';
import { WorkingMemoryObservation, WorkingMemoryState } from './types';

/**
 * Working Memory — whitepaper §4: "the current match's live state ...
 * Ephemeral, in-process, discarded (or promoted) at match end."
 *
 * Deliberately the only store in this package with NO database at all: a
 * plain in-process Map. This is intentional, not a shortcut — the whitepaper
 * is explicit that working memory should be "free — no persistence cost."
 * A crashed process loses in-flight working memory, which is the correct
 * tradeoff (it's re-derivable from the match's own live event stream; it was
 * never the durable record of anything).
 */
export class WorkingMemoryStore {
  private readonly matches = new Map<string, WorkingMemoryState>();

  constructor(private readonly config: WorkingMemoryConfig) {}

  /** Creates (or resets) the working-memory state for a match. Idempotent — calling twice for the same matchId starts fresh. */
  start(matchId: string, playerId: string, gameId: string, now: number = Date.now()): WorkingMemoryState {
    const state: WorkingMemoryState = {
      matchId,
      playerId,
      gameId,
      startedAt: now,
      lastTouchedAt: now,
      plan: null,
      recentObservations: [],
      counters: {},
      context: {},
    };
    this.matches.set(matchId, state);
    return state;
  }

  get(matchId: string): WorkingMemoryState | null {
    return this.matches.get(matchId) ?? null;
  }

  private require(matchId: string): WorkingMemoryState {
    const state = this.matches.get(matchId);
    if (!state) throw new WorkingMemoryNotFoundError(matchId);
    return state;
  }

  /** Replaces the active plan object wholesale — the Strategy Planner's job in a future phase, stored opaquely here. */
  setPlan(matchId: string, plan: Record<string, unknown> | null, now: number = Date.now()): WorkingMemoryState {
    const state = this.require(matchId);
    state.plan = plan;
    state.lastTouchedAt = now;
    return state;
  }

  /** Pushes an observation into the bounded ring buffer, evicting the oldest entry once at capacity. */
  pushObservation(matchId: string, observation: Omit<WorkingMemoryObservation, 'ts'> & { ts?: number }, now: number = Date.now()): WorkingMemoryState {
    const state = this.require(matchId);
    state.recentObservations.push({ ts: observation.ts ?? now, kind: observation.kind, payload: observation.payload });
    if (state.recentObservations.length > this.config.maxObservations) {
      state.recentObservations.splice(0, state.recentObservations.length - this.config.maxObservations);
    }
    state.lastTouchedAt = now;
    return state;
  }

  incrementCounter(matchId: string, counterName: string, delta: number = 1, now: number = Date.now()): WorkingMemoryState {
    const state = this.require(matchId);
    state.counters[counterName] = (state.counters[counterName] ?? 0) + delta;
    state.lastTouchedAt = now;
    return state;
  }

  setContext(matchId: string, patch: Record<string, unknown>, now: number = Date.now()): WorkingMemoryState {
    const state = this.require(matchId);
    state.context = { ...state.context, ...patch };
    state.lastTouchedAt = now;
    return state;
  }

  /** Discards a match's working memory entirely — called at match end (after promotion) or on abandonment cleanup. */
  destroy(matchId: string): boolean {
    return this.matches.delete(matchId);
  }

  /** Sweeps matches whose working memory hasn't been touched in `maxIdleMs` — crash/never-ended-match resilience. Returns the matchIds removed. */
  deleteExpired(now: number = Date.now(), maxIdleMs: number = this.config.maxIdleMs): string[] {
    const removed: string[] = [];
    for (const [matchId, state] of this.matches) {
      if (now - state.lastTouchedAt > maxIdleMs) {
        this.matches.delete(matchId);
        removed.push(matchId);
      }
    }
    return removed;
  }

  /** Test/ops helper: how many matches currently hold working memory. */
  size(): number {
    return this.matches.size;
  }
}
