/** Typed error hierarchy for the Memory Engine — same convention as @adaptive-ai/event-pipeline's errors.ts. */
export abstract class MemoryEngineError extends Error {
  abstract readonly code: string;
}

export class WorkingMemoryNotFoundError extends MemoryEngineError {
  readonly code = 'WORKING_MEMORY_NOT_FOUND';
  constructor(matchId: string) {
    super(`No working memory exists for match ${matchId}`);
    this.name = 'WorkingMemoryNotFoundError';
  }
}

export class ShortTermMemoryNotFoundError extends MemoryEngineError {
  readonly code = 'SHORT_TERM_MEMORY_NOT_FOUND';
  constructor(matchId: string) {
    super(`No short-term memory exists for match ${matchId}`);
    this.name = 'ShortTermMemoryNotFoundError';
  }
}

export class SemanticWriteConflictError extends MemoryEngineError {
  readonly code = 'SEMANTIC_WRITE_CONFLICT';
  constructor(playerId: string, gameId: string | null, dimension: string, attempts: number) {
    super(`Concurrent update conflict on ${playerId}/${gameId ?? 'cross-game'}/${dimension} after ${attempts} retries`);
    this.name = 'SemanticWriteConflictError';
  }
}

export class SemanticVersionNotFoundError extends MemoryEngineError {
  readonly code = 'SEMANTIC_VERSION_NOT_FOUND';
  constructor(playerId: string, gameId: string | null, dimension: string, version: number) {
    super(`No version ${version} exists for ${playerId}/${gameId ?? 'cross-game'}/${dimension}`);
    this.name = 'SemanticVersionNotFoundError';
  }
}

export class InvalidEpisodeError extends MemoryEngineError {
  readonly code = 'INVALID_EPISODE';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidEpisodeError';
  }
}

export function isMemoryEngineError(err: unknown): err is MemoryEngineError {
  return err instanceof MemoryEngineError;
}
