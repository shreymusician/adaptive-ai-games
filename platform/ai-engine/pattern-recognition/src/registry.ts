/**
 * PatternRegistry — detector registration, dependency ordering, versioning,
 * discovery, and execution. This is the ONLY place that knows about more
 * than one detector at a time; a new pattern type is added by implementing
 * PatternDetector and calling `register()` — no existing detector file is
 * ever touched.
 */

import { PatternDetector, PatternDetectorFactory } from './detector';
import { Logger } from './logger';
import { CyclicDetectorDependencyError, DuplicateDetectorError, UnknownDetectorDependencyError, UnknownDetectorError } from './errors';
import { DetectorResult, DetectorRunContext, PatternDetectorMetadata, ShortTermEventRef } from './types';

export interface DetectorExecutionOutcome {
  detectorId: string;
  result: DetectorResult | null;
  error: string | null;
}

export class PatternRegistry {
  private readonly factories = new Map<string, PatternDetectorFactory>();
  private readonly metadataById = new Map<string, PatternDetectorMetadata>();
  private cachedOrder: string[] | null = null;

  register(factory: PatternDetectorFactory): void {
    const probe = factory();
    const meta = probe.metadata;
    if (this.factories.has(meta.id)) throw new DuplicateDetectorError(meta.id);
    this.factories.set(meta.id, factory);
    this.metadataById.set(meta.id, meta);
    this.cachedOrder = null;
  }

  unregister(detectorId: string): boolean {
    this.cachedOrder = null;
    this.metadataById.delete(detectorId);
    return this.factories.delete(detectorId);
  }

  list(): PatternDetectorMetadata[] {
    return [...this.metadataById.values()];
  }

  get(detectorId: string): PatternDetectorMetadata | undefined {
    return this.metadataById.get(detectorId);
  }

  has(detectorId: string): boolean {
    return this.factories.has(detectorId);
  }

  /** Topological order (Kahn's algorithm) over `dependsOn`. Cached until the next register()/unregister(). */
  executionOrder(): string[] {
    if (this.cachedOrder) return this.cachedOrder;

    for (const meta of this.metadataById.values()) {
      for (const dep of meta.dependsOn ?? []) {
        if (!this.metadataById.has(dep)) throw new UnknownDetectorDependencyError(meta.id, dep);
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
      throw new CyclicDetectorDependencyError(ids.filter((id) => !order.includes(id)));
    }

    this.cachedOrder = order;
    return order;
  }

  /** Executes every registered detector, in dependency order, with per-detector failure isolation — a thrown error is caught and recorded against that detector only, never aborting the rest of the run. */
  execute(ctx: Omit<DetectorRunContext, 'siblingResults'>, events: ShortTermEventRef[], logger?: Logger): { instances: Map<string, PatternDetector>; outcomes: DetectorExecutionOutcome[] } {
    const order = this.executionOrder();
    const instances = new Map<string, PatternDetector>();
    const siblingResults = new Map<string, DetectorResult>();
    const outcomes: DetectorExecutionOutcome[] = [];

    for (const id of order) {
      const factory = this.factories.get(id);
      if (!factory) throw new UnknownDetectorError(id);
      const detector = factory();
      instances.set(id, detector);
      const runCtx: DetectorRunContext = { ...ctx, siblingResults };
      try {
        detector.initialize(runCtx);
        for (const event of events) detector.consumeEvent(event, runCtx);
        detector.consumeMatch(runCtx);
        const result = detector.detect();
        siblingResults.set(id, result);
        outcomes.push({ detectorId: id, result, error: null });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger?.error('Detector execution failed — isolated, run continues', { detectorId: id, error: message });
        outcomes.push({ detectorId: id, result: null, error: message });
      }
    }

    return { instances, outcomes };
  }
}
