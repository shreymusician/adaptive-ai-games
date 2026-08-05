/** Typed error hierarchy for the Decision Engine — same convention as every other AI-engine package's errors.ts. */
export abstract class DecisionEngineError extends Error {
  abstract readonly code: string;
}

export class DuplicateConsiderationError extends DecisionEngineError {
  readonly code = 'DUPLICATE_CONSIDERATION';
  constructor(considerationId: string) {
    super(`A consideration for "${considerationId}" is already registered`);
    this.name = 'DuplicateConsiderationError';
  }
}

export class UnknownConsiderationDependencyError extends DecisionEngineError {
  readonly code = 'UNKNOWN_CONSIDERATION_DEPENDENCY';
  constructor(considerationId: string, missingDependency: string) {
    super(`Consideration "${considerationId}" depends on unregistered consideration "${missingDependency}"`);
    this.name = 'UnknownConsiderationDependencyError';
  }
}

export class CyclicConsiderationDependencyError extends DecisionEngineError {
  readonly code = 'CYCLIC_CONSIDERATION_DEPENDENCY';
  constructor(cycle: string[]) {
    super(`Cyclic consideration dependency detected: ${cycle.join(' -> ')}`);
    this.name = 'CyclicConsiderationDependencyError';
  }
}

export class UnknownConsiderationError extends DecisionEngineError {
  readonly code = 'UNKNOWN_CONSIDERATION';
  constructor(considerationId: string) {
    super(`No consideration is registered for "${considerationId}"`);
    this.name = 'UnknownConsiderationError';
  }
}

/** "No legal actions exist" — the plugin's getLegalActions() returned an empty array. The engine cannot invent an action, so this is fatal to the decide() call, not silently substituted. */
export class NoLegalActionsError extends DecisionEngineError {
  readonly code = 'NO_LEGAL_ACTIONS';
  constructor(matchId: string) {
    super(`No legal actions were provided for match ${matchId} — the Decision Engine cannot invent an action`);
    this.name = 'NoLegalActionsError';
  }
}

/** "Plugin returns malformed actions" — legalActions was not a valid Action[] at all (not just partially invalid entries, which are instead skipped and counted in DecisionMetadata.actionsSkippedMalformed). */
export class MalformedLegalActionsError extends DecisionEngineError {
  readonly code = 'MALFORMED_LEGAL_ACTIONS';
  constructor(matchId: string, reason: string) {
    super(`legalActions for match ${matchId} is not a valid action list: ${reason}`);
    this.name = 'MalformedLegalActionsError';
  }
}

/** "Strategy is invalid" — the supplied StrategicIntent fails basic structural validation. */
export class InvalidStrategicIntentError extends DecisionEngineError {
  readonly code = 'INVALID_STRATEGIC_INTENT';
  constructor(reason: string) {
    super(`StrategicIntent is invalid: ${reason}`);
    this.name = 'InvalidStrategicIntentError';
  }
}

export function isDecisionEngineError(err: unknown): err is DecisionEngineError {
  return err instanceof DecisionEngineError;
}
