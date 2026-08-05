/** Typed error hierarchy for Orchestration — same convention as the other AI-engine packages' errors.ts. */
export abstract class OrchestrationError extends Error {
  abstract readonly code: string;
}

/** Raised when an event arrives for a match that was already completed (commitMatch already ran) — the orchestrator refuses to reopen a closed match rather than silently corrupting a committed record. */
export class MatchAlreadyCompletedError extends OrchestrationError {
  readonly code = 'MATCH_ALREADY_COMPLETED';
  constructor(matchId: string) {
    super(`Match ${matchId} was already completed — cannot ingest further events or complete it again`);
    this.name = 'MatchAlreadyCompletedError';
  }
}

/** Raised when completeMatch() is called for a match that never received a MatchStarted/first event — nothing to commit. */
export class MatchNeverStartedError extends OrchestrationError {
  readonly code = 'MATCH_NEVER_STARTED';
  constructor(matchId: string) {
    super(`Match ${matchId} has no working/short-term memory — it was never started`);
    this.name = 'MatchNeverStartedError';
  }
}

/**
 * Raised when Memory Engine's own commitMatch() step fails. This is the one
 * stage the orchestrator treats as fatal — everything downstream (Player
 * Modeling, Pattern Recognition) reads the committed MatchMemoryRecord, so a
 * failed commit means there is nothing safe to process further. Working
 * Memory / Short-Term Memory are left exactly as Memory Engine's own
 * commitMatch() left them (it never partially applies).
 */
export class MemoryCommitFailedError extends OrchestrationError {
  readonly code = 'MEMORY_COMMIT_FAILED';
  constructor(matchId: string, cause: string) {
    super(`Failed to commit match memory for ${matchId}: ${cause}`);
    this.name = 'MemoryCommitFailedError';
  }
}

export function isOrchestrationError(err: unknown): err is OrchestrationError {
  return err instanceof OrchestrationError;
}
