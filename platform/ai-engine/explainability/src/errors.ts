/** Typed error hierarchy for the Explainability Engine — same convention as every other AI-engine package's errors.ts. */
export abstract class ExplainabilityError extends Error {
  abstract readonly code: string;
}

/**
 * "Missing reasoning data" — a Decision/StrategicIntent's own AwarenessUsed
 * record says a specific pattern/dimension/episode id was actually read,
 * but the caller's supplied context array doesn't contain a matching entry.
 * This is a genuine upstream data-integrity gap (the caller passed a stale
 * or incomplete snapshot) — the engine refuses to either fabricate a
 * plausible-sounding stand-in for it OR silently drop it (dropping would
 * under-report evidence the decision genuinely used), so it fails loudly
 * instead.
 */
export class MissingReasoningDataError extends ExplainabilityError {
  readonly code = 'MISSING_REASONING_DATA';
  constructor(kind: string, id: string, context: string) {
    super(`${kind} "${id}" was recorded as read in ${context}'s AwarenessUsed, but no matching entry was supplied in the caller's context`);
    this.name = 'MissingReasoningDataError';
  }
}

/** The supplied StrategicIntent's `goalId` doesn't match `decision.reasoningTrace.strategicIntentGoalId` — the two records don't describe the same causal chain, so explaining them together would misattribute reasoning. */
export class IntentDecisionMismatchError extends ExplainabilityError {
  readonly code = 'INTENT_DECISION_MISMATCH';
  constructor(decisionGoalId: string, intentGoalId: string) {
    super(`Decision's reasoningTrace.strategicIntentGoalId ("${decisionGoalId}") does not match the supplied StrategicIntent's goalId ("${intentGoalId}")`);
    this.name = 'IntentDecisionMismatchError';
  }
}

/** The winning action referenced by `decision.action.id` has no corresponding entry in `decision.reasoningTrace.perActionBreakdown` / `decision.score.breakdown` — the Decision record itself is structurally incomplete. */
export class MalformedDecisionTraceError extends ExplainabilityError {
  readonly code = 'MALFORMED_DECISION_TRACE';
  constructor(decisionId: string, reason: string) {
    super(`Decision ${decisionId}'s reasoning trace is malformed: ${reason}`);
    this.name = 'MalformedDecisionTraceError';
  }
}

/** The winning goal referenced by `strategicIntent.goalId` has no corresponding entry in `strategicIntent.planningTrace.candidates` — the StrategicIntent record itself is structurally incomplete. */
export class MalformedPlanningTraceError extends ExplainabilityError {
  readonly code = 'MALFORMED_PLANNING_TRACE';
  constructor(intentId: string, reason: string) {
    super(`StrategicIntent ${intentId}'s planning trace is malformed: ${reason}`);
    this.name = 'MalformedPlanningTraceError';
  }
}

/** A history array supplied for a Behavior/Confidence Evolution or Match Comparison call has fewer than the minimum required entries (2) to compute a trend. */
export class InsufficientHistoryError extends ExplainabilityError {
  readonly code = 'INSUFFICIENT_HISTORY';
  constructor(subject: string, count: number) {
    super(`At least 2 history entries are required to compute a trend for ${subject}, got ${count}`);
    this.name = 'InsufficientHistoryError';
  }
}

/** summarizeMatch() was called with zero DecisionExplanations — there is nothing to summarize, and a summary asserting "0 decisions" as if it were a real match would be misleadingly precise. */
export class EmptyDecisionSetError extends ExplainabilityError {
  readonly code = 'EMPTY_DECISION_SET';
  constructor(matchId: string) {
    super(`Cannot summarize match ${matchId}: no DecisionExplanations were supplied`);
    this.name = 'EmptyDecisionSetError';
  }
}

/** A batch of DecisionExplanations supplied to summarizeMatch() contains an entry whose matchId/playerId/gameId doesn't match the rest — mixing data from different matches would produce a summary that isn't truthfully about ONE match. */
export class InconsistentMatchDataError extends ExplainabilityError {
  readonly code = 'INCONSISTENT_MATCH_DATA';
  constructor(expectedMatchId: string, actualMatchId: string, decisionId: string) {
    super(`Decision ${decisionId} belongs to match ${actualMatchId}, not the expected match ${expectedMatchId}`);
    this.name = 'InconsistentMatchDataError';
  }
}

/** A requested explanation (by id, or by match/player) does not exist in the ExplanationStore. */
export class ExplanationNotFoundError extends ExplainabilityError {
  readonly code = 'EXPLANATION_NOT_FOUND';
  constructor(reason: string) {
    super(`No stored explanation found: ${reason}`);
    this.name = 'ExplanationNotFoundError';
  }
}

export function isExplainabilityError(err: unknown): err is ExplainabilityError {
  return err instanceof ExplainabilityError;
}
