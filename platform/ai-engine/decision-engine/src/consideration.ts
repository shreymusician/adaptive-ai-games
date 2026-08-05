/**
 * The standard interface every Consideration implements — the Utility AI
 * scoring unit (whitepaper §6's "considerations"). Each Consideration is a
 * fully independent module: it scores ONE action against ONE concern (plan
 * adherence, safety, exploiting a known pattern, ...), never knows about
 * any other consideration's internals (only its already-computed
 * ConsiderationResult, via siblingResults, and only if declared in
 * `dependsOn`), and NEVER weighs itself by personality — that happens
 * exactly once, externally, when the evaluator combines every
 * consideration's result (see evaluator.ts).
 *
 * Lifecycle — called once per (action, consideration) pair, per decide()
 * call:
 *   metadata()    — static descriptor, readable any time
 *   evaluate(ctx) — pure: derive this consideration's [0,1] value for this
 *     action. No I/O, no mutation, no randomness.
 */

import { ConsiderationContext, ConsiderationMetadata, ConsiderationResult } from './types';

export interface Consideration {
  readonly metadata: ConsiderationMetadata;
  evaluate(ctx: ConsiderationContext): ConsiderationResult;
}

export type ConsiderationFactory = () => Consideration;

/**
 * Shared plumbing: clamps the returned value into [0,1] so a consideration
 * file only ever implements `score()` — never the boilerplate around it.
 * Optional to extend; a consideration may implement `Consideration` directly
 * if it needs full control (none of the six in this phase do).
 */
export abstract class BaseConsideration implements Consideration {
  abstract readonly metadata: ConsiderationMetadata;

  protected abstract score(ctx: ConsiderationContext): { value: number; reasoning: Record<string, unknown> };

  evaluate(ctx: ConsiderationContext): ConsiderationResult {
    const { value, reasoning } = this.score(ctx);
    return {
      considerationId: this.metadata.id,
      value: Math.min(1, Math.max(0, value)),
      reasoning,
    };
  }
}
