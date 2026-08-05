/**
 * GoalRegistry — registration, discovery, dependency ordering, versioning,
 * and execution. Structurally a direct parallel to player-modeling's
 * DimensionRegistry and pattern-recognition's PatternRegistry, operating on
 * Goal instead of DimensionAnalyzer/PatternDetector — the same proven
 * pattern, a third time, deliberately not reinvented.
 */

import { GoalFactory } from './goal';
import { Logger } from './logger';
import { CyclicGoalDependencyError, DuplicateGoalError, UnknownGoalDependencyError, UnknownGoalError } from './errors';
import { GoalEvaluationContext, GoalEvaluationResult, GoalMetadata } from './types';

export interface GoalExecutionOutcome {
  goalId: string;
  result: GoalEvaluationResult | null;
  error: string | null;
}

export class GoalRegistry {
  private readonly factories = new Map<string, GoalFactory>();
  private readonly metadataById = new Map<string, GoalMetadata>();
  private cachedOrder: string[] | null = null;

  /** Registers a new goal. Throws DuplicateGoalError if the id is already taken. Dependency existence/cycles are validated lazily by executionOrder(), so registration order never matters. */
  register(factory: GoalFactory): void {
    const probe = factory();
    const meta = probe.metadata;
    if (this.factories.has(meta.id)) throw new DuplicateGoalError(meta.id);
    this.factories.set(meta.id, factory);
    this.metadataById.set(meta.id, meta);
    this.cachedOrder = null;
  }

  /** Mainly a test/ops hook. Invalidates the cached execution order. */
  unregister(goalId: string): boolean {
    this.cachedOrder = null;
    this.metadataById.delete(goalId);
    return this.factories.delete(goalId);
  }

  list(): GoalMetadata[] {
    return [...this.metadataById.values()];
  }

  get(goalId: string): GoalMetadata | undefined {
    return this.metadataById.get(goalId);
  }

  has(goalId: string): boolean {
    return this.factories.has(goalId);
  }

  /**
   * Topologically orders goals by `dependsOn` (Kahn's algorithm) so a
   * dependency always executes — and populates `siblingResults` — before
   * anything that reads it. Deterministic among goals with no relative
   * ordering constraint (insertion order is the tiebreak). Cached until the
   * next register()/unregister() call.
   */
  executionOrder(): string[] {
    if (this.cachedOrder) return this.cachedOrder;

    for (const meta of this.metadataById.values()) {
      for (const dep of meta.dependsOn ?? []) {
        if (!this.metadataById.has(dep)) throw new UnknownGoalDependencyError(meta.id, dep);
      }
    }

    const ids = [...this.metadataById.keys()];
    const inDegree = new Map<string, number>(ids.map((id) => [id, 0]));
    const dependents = new Map<string, string[]>(ids.map((id) => [id, []]));
    for (const id of ids) {
      const deps = this.metadataById.get(id)!.dependsOn ?? [];
      inDegree.set(id, deps.length);
      for (const dep of deps) dependents.get(dep)!.push(id);
    }

    const queue = ids.filter((id) => inDegree.get(id) === 0);
    const order: string[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      order.push(id);
      for (const dependent of dependents.get(id)!) {
        const next = inDegree.get(dependent)! - 1;
        inDegree.set(dependent, next);
        if (next === 0) queue.push(dependent);
      }
    }

    if (order.length !== ids.length) {
      const remaining = ids.filter((id) => !order.includes(id));
      throw new CyclicGoalDependencyError(remaining);
    }

    this.cachedOrder = order;
    return order;
  }

  /**
   * Evaluates every registered goal, in dependency order, against one
   * shared base context. Each goal runs in complete isolation: a thrown
   * error is caught and recorded against that goal only (failure
   * isolation), never aborting the remaining evaluation — the same
   * guarantee player-modeling's/pattern-recognition's registries give.
   */
  evaluateAll(baseCtx: Omit<GoalEvaluationContext, 'siblingResults'>, logger?: Logger): { outcomes: GoalExecutionOutcome[]; results: Map<string, GoalEvaluationResult> } {
    const order = this.executionOrder();
    const siblingResults = new Map<string, GoalEvaluationResult>();
    const outcomes: GoalExecutionOutcome[] = [];

    for (const id of order) {
      const factory = this.factories.get(id);
      if (!factory) throw new UnknownGoalError(id);
      const goal = factory();
      const ctx: GoalEvaluationContext = { ...baseCtx, siblingResults };
      try {
        const result = goal.evaluate(ctx);
        siblingResults.set(id, result);
        outcomes.push({ goalId: id, result, error: null });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger?.error('Goal evaluation failed — isolated, run continues', { goalId: id, error: message });
        outcomes.push({ goalId: id, result: null, error: message });
      }
    }

    return { outcomes, results: siblingResults };
  }
}
