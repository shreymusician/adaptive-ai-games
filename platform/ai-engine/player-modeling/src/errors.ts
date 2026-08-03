/** Typed error hierarchy for Player Modeling — same convention as @adaptive-ai/memory-engine's errors.ts. */
export abstract class PlayerModelingError extends Error {
  abstract readonly code: string;
}

export class DuplicateAnalyzerError extends PlayerModelingError {
  readonly code = 'DUPLICATE_ANALYZER';
  constructor(dimensionId: string) {
    super(`An analyzer for dimension "${dimensionId}" is already registered`);
    this.name = 'DuplicateAnalyzerError';
  }
}

export class UnknownDependencyError extends PlayerModelingError {
  readonly code = 'UNKNOWN_DEPENDENCY';
  constructor(dimensionId: string, missingDependency: string) {
    super(`Analyzer "${dimensionId}" depends on unregistered dimension "${missingDependency}"`);
    this.name = 'UnknownDependencyError';
  }
}

export class CyclicDependencyError extends PlayerModelingError {
  readonly code = 'CYCLIC_DEPENDENCY';
  constructor(cycle: string[]) {
    super(`Cyclic analyzer dependency detected: ${cycle.join(' -> ')}`);
    this.name = 'CyclicDependencyError';
  }
}

export class UnknownAnalyzerError extends PlayerModelingError {
  readonly code = 'UNKNOWN_ANALYZER';
  constructor(dimensionId: string) {
    super(`No analyzer is registered for dimension "${dimensionId}"`);
    this.name = 'UnknownAnalyzerError';
  }
}

export class MatchNotCommittedError extends PlayerModelingError {
  readonly code = 'MATCH_NOT_COMMITTED';
  constructor(matchId: string) {
    super(`Match ${matchId} has not been committed via MemoryEngine.commitMatch — Player Modeling runs only after MatchEnded`);
    this.name = 'MatchNotCommittedError';
  }
}

export function isPlayerModelingError(err: unknown): err is PlayerModelingError {
  return err instanceof PlayerModelingError;
}
