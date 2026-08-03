/**
 * DimensionRegistry — analyzer registration, dependency ordering,
 * versioning, discovery, and execution. This is the ONLY place that knows
 * about more than one analyzer at a time; a new behavioral dimension is
 * added by implementing DimensionAnalyzer and calling `register()` — no
 * existing analyzer file is ever touched (whitepaper Phase 5 "Dimension
 * Registry" requirement).
 */

import { DimensionAnalyzer, DimensionAnalyzerFactory } from './analyzer';
import { Logger } from './logger';
import { CyclicDependencyError, DuplicateAnalyzerError, UnknownAnalyzerError, UnknownDependencyError } from './errors';
import { AnalyzerRunContext, DimensionAnalyzerMetadata, DimensionAnalyzerResult, ShortTermEventRef } from './types';

export interface AnalyzerExecutionOutcome {
  dimensionId: string;
  result: DimensionAnalyzerResult | null;
  error: string | null;
}

export class DimensionRegistry {
  private readonly factories = new Map<string, DimensionAnalyzerFactory>();
  private readonly metadataById = new Map<string, DimensionAnalyzerMetadata>();
  private cachedOrder: string[] | null = null;

  /** Registers a new analyzer. Throws DuplicateAnalyzerError if the id is already taken. Dependency existence/cycles are validated lazily by executionOrder(), so registration order never matters. */
  register(factory: DimensionAnalyzerFactory): void {
    const probe = factory();
    const meta = probe.metadata;
    if (this.factories.has(meta.id)) throw new DuplicateAnalyzerError(meta.id);
    this.factories.set(meta.id, factory);
    this.metadataById.set(meta.id, meta);
    this.cachedOrder = null;
  }

  /** Removes a registered analyzer — mainly a test/ops hook. Invalidates the cached execution order. */
  unregister(dimensionId: string): boolean {
    this.cachedOrder = null;
    this.metadataById.delete(dimensionId);
    return this.factories.delete(dimensionId);
  }

  list(): DimensionAnalyzerMetadata[] {
    return [...this.metadataById.values()];
  }

  get(dimensionId: string): DimensionAnalyzerMetadata | undefined {
    return this.metadataById.get(dimensionId);
  }

  has(dimensionId: string): boolean {
    return this.factories.has(dimensionId);
  }

  /**
   * Topologically orders analyzers by `dependsOn` (Kahn's algorithm) so a
   * dependency always executes — and populates `siblingResults` — before
   * anything that reads it. Deterministic among analyzers with no relative
   * ordering constraint (insertion order is the tiebreak). Result is cached
   * until the next register()/unregister() call.
   */
  executionOrder(): string[] {
    if (this.cachedOrder) return this.cachedOrder;

    for (const meta of this.metadataById.values()) {
      for (const dep of meta.dependsOn ?? []) {
        if (!this.metadataById.has(dep)) throw new UnknownDependencyError(meta.id, dep);
      }
      for (const dep of meta.historyDependsOn ?? []) {
        if (!this.metadataById.has(dep)) throw new UnknownDependencyError(meta.id, dep);
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
      throw new CyclicDependencyError(remaining);
    }

    this.cachedOrder = order;
    return order;
  }

  /**
   * Executes every registered analyzer, in dependency order, over one
   * match's event log. Each analyzer runs in complete isolation: a thrown
   * error is caught and recorded against that analyzer only (failure
   * isolation), never aborting the remaining run. Returns fresh analyzer
   * instances alongside their outcomes so the caller (PlayerModelingEngine)
   * can still call `update()`/`confidence()` on a successfully-run analyzer.
   */
  execute(ctx: Omit<AnalyzerRunContext, 'siblingResults'>, events: ShortTermEventRef[], logger?: Logger): { instances: Map<string, DimensionAnalyzer>; outcomes: AnalyzerExecutionOutcome[] } {
    const order = this.executionOrder();
    const instances = new Map<string, DimensionAnalyzer>();
    const siblingResults = new Map<string, DimensionAnalyzerResult>();
    const outcomes: AnalyzerExecutionOutcome[] = [];

    for (const id of order) {
      const factory = this.factories.get(id);
      if (!factory) throw new UnknownAnalyzerError(id);
      const analyzer = factory();
      instances.set(id, analyzer);
      const runCtx: AnalyzerRunContext = { ...ctx, siblingResults };
      try {
        analyzer.initialize(runCtx);
        for (const event of events) analyzer.consumeEvent(event, runCtx);
        analyzer.consumeMatch(runCtx);
        const result = analyzer.calculate();
        siblingResults.set(id, result);
        outcomes.push({ dimensionId: id, result, error: null });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger?.error('Analyzer execution failed — isolated, run continues', { dimensionId: id, error: message });
        outcomes.push({ dimensionId: id, result: null, error: message });
      }
    }

    return { instances, outcomes };
  }
}
