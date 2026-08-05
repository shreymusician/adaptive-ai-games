/**
 * DecisionRegistry (ConsiderationRegistry) — registration, discovery,
 * dependency ordering, versioning, and execution. Structurally the FOURTH
 * instance of the same registry pattern already proven in this monorepo
 * (player-modeling's DimensionRegistry, pattern-recognition's
 * PatternRegistry, strategy-planner's GoalRegistry) — the same proven
 * shape, deliberately not reinvented, operating on Consideration instead.
 */

import { ConsiderationFactory } from './consideration';
import { Logger } from './logger';
import { CyclicConsiderationDependencyError, DuplicateConsiderationError, UnknownConsiderationDependencyError, UnknownConsiderationError } from './errors';
import { ConsiderationContext, ConsiderationMetadata, ConsiderationResult } from './types';

export interface ConsiderationExecutionOutcome {
  considerationId: string;
  result: ConsiderationResult | null;
  error: string | null;
}

export class DecisionRegistry {
  private readonly factories = new Map<string, ConsiderationFactory>();
  private readonly metadataById = new Map<string, ConsiderationMetadata>();
  private cachedOrder: string[] | null = null;

  register(factory: ConsiderationFactory): void {
    const probe = factory();
    const meta = probe.metadata;
    if (this.factories.has(meta.id)) throw new DuplicateConsiderationError(meta.id);
    this.factories.set(meta.id, factory);
    this.metadataById.set(meta.id, meta);
    this.cachedOrder = null;
  }

  unregister(considerationId: string): boolean {
    this.cachedOrder = null;
    this.metadataById.delete(considerationId);
    return this.factories.delete(considerationId);
  }

  list(): ConsiderationMetadata[] {
    return [...this.metadataById.values()];
  }

  get(considerationId: string): ConsiderationMetadata | undefined {
    return this.metadataById.get(considerationId);
  }

  has(considerationId: string): boolean {
    return this.factories.has(considerationId);
  }

  /** Topologically orders considerations by `dependsOn` (Kahn's algorithm), same convention as every other registry in this monorepo. Deterministic (insertion order is the tiebreak), cached until the next register()/unregister(). */
  executionOrder(): string[] {
    if (this.cachedOrder) return this.cachedOrder;

    for (const meta of this.metadataById.values()) {
      for (const dep of meta.dependsOn ?? []) {
        if (!this.metadataById.has(dep)) throw new UnknownConsiderationDependencyError(meta.id, dep);
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
      throw new CyclicConsiderationDependencyError(remaining);
    }

    this.cachedOrder = order;
    return order;
  }

  /**
   * Evaluates every registered consideration, in dependency order, for ONE
   * action. Each consideration runs in complete isolation: a thrown error
   * is caught and recorded against that consideration only (failure
   * isolation), never aborting the rest — same guarantee every other
   * registry in this monorepo gives.
   */
  evaluateAll(baseCtx: Omit<ConsiderationContext, 'siblingResults'>, logger?: Logger): { outcomes: ConsiderationExecutionOutcome[]; results: Map<string, ConsiderationResult> } {
    const order = this.executionOrder();
    const siblingResults = new Map<string, ConsiderationResult>();
    const outcomes: ConsiderationExecutionOutcome[] = [];

    for (const id of order) {
      const factory = this.factories.get(id);
      if (!factory) throw new UnknownConsiderationError(id);
      const consideration = factory();
      const ctx: ConsiderationContext = { ...baseCtx, siblingResults };
      try {
        const result = consideration.evaluate(ctx);
        siblingResults.set(id, result);
        outcomes.push({ considerationId: id, result, error: null });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger?.error('Consideration evaluation failed — isolated, run continues', { considerationId: id, error: message });
        outcomes.push({ considerationId: id, result: null, error: message });
      }
    }

    return { outcomes, results: siblingResults };
  }
}
