/** Typed error hierarchy for Pattern Recognition — same convention as @adaptive-ai/memory-engine's/@adaptive-ai/player-modeling's errors.ts. */
export abstract class PatternRecognitionError extends Error {
  abstract readonly code: string;
}

export class DuplicateDetectorError extends PatternRecognitionError {
  readonly code = 'DUPLICATE_DETECTOR';
  constructor(detectorId: string) {
    super(`A detector for "${detectorId}" is already registered`);
    this.name = 'DuplicateDetectorError';
  }
}

export class UnknownDetectorDependencyError extends PatternRecognitionError {
  readonly code = 'UNKNOWN_DETECTOR_DEPENDENCY';
  constructor(detectorId: string, missingDependency: string) {
    super(`Detector "${detectorId}" depends on unregistered detector "${missingDependency}"`);
    this.name = 'UnknownDetectorDependencyError';
  }
}

export class CyclicDetectorDependencyError extends PatternRecognitionError {
  readonly code = 'CYCLIC_DETECTOR_DEPENDENCY';
  constructor(cycle: string[]) {
    super(`Cyclic detector dependency detected: ${cycle.join(' -> ')}`);
    this.name = 'CyclicDetectorDependencyError';
  }
}

export class UnknownDetectorError extends PatternRecognitionError {
  readonly code = 'UNKNOWN_DETECTOR';
  constructor(detectorId: string) {
    super(`No detector is registered for "${detectorId}"`);
    this.name = 'UnknownDetectorError';
  }
}

export class MatchNotCommittedError extends PatternRecognitionError {
  readonly code = 'MATCH_NOT_COMMITTED';
  constructor(matchId: string) {
    super(`Match ${matchId} has not been committed via MemoryEngine.commitMatch — Pattern Recognition runs only after MatchEnded`);
    this.name = 'MatchNotCommittedError';
  }
}

export class PatternNotFoundError extends PatternRecognitionError {
  readonly code = 'PATTERN_NOT_FOUND';
  constructor(patternRecordId: string) {
    super(`No pattern record exists with id ${patternRecordId}`);
    this.name = 'PatternNotFoundError';
  }
}

export function isPatternRecognitionError(err: unknown): err is PatternRecognitionError {
  return err instanceof PatternRecognitionError;
}
