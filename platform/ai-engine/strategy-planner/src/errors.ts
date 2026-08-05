/** Typed error hierarchy for Strategy Planner — same convention as every other AI-engine package's errors.ts. */
export abstract class StrategyPlannerError extends Error {
  abstract readonly code: string;
}

export class DuplicateGoalError extends StrategyPlannerError {
  readonly code = 'DUPLICATE_GOAL';
  constructor(goalId: string) {
    super(`A goal for "${goalId}" is already registered`);
    this.name = 'DuplicateGoalError';
  }
}

export class UnknownGoalDependencyError extends StrategyPlannerError {
  readonly code = 'UNKNOWN_GOAL_DEPENDENCY';
  constructor(goalId: string, missingDependency: string) {
    super(`Goal "${goalId}" depends on unregistered goal "${missingDependency}"`);
    this.name = 'UnknownGoalDependencyError';
  }
}

export class CyclicGoalDependencyError extends StrategyPlannerError {
  readonly code = 'CYCLIC_GOAL_DEPENDENCY';
  constructor(cycle: string[]) {
    super(`Cyclic goal dependency detected: ${cycle.join(' -> ')}`);
    this.name = 'CyclicGoalDependencyError';
  }
}

export class UnknownGoalError extends StrategyPlannerError {
  readonly code = 'UNKNOWN_GOAL';
  constructor(goalId: string) {
    super(`No goal is registered for "${goalId}"`);
    this.name = 'UnknownGoalError';
  }
}

export class NoEligibleGoalError extends StrategyPlannerError {
  readonly code = 'NO_ELIGIBLE_GOAL';
  constructor() {
    super('No registered goal had its preconditions met, and no fallback goal was registered — the registry must include at least one always-eligible goal');
    this.name = 'NoEligibleGoalError';
  }
}

export function isStrategyPlannerError(err: unknown): err is StrategyPlannerError {
  return err instanceof StrategyPlannerError;
}
