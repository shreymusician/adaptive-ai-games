/**
 * Action Freshness — a purely mechanical consideration exercising the real
 * `Action.legalUntil` field the Plugin SDK declares (sdk-protocol's own
 * doc comment: "so it can't be tricked into acting on stale information").
 * An action about to expire gets a small urgency boost — concrete, genre-
 * agnostic use of the actual SDK contract, not a genre-specific convention
 * like the `tags`/`counters*`/`punishes*` opt-in fields the other five
 * considerations read. Always active; never awareness-gated (legalUntil is
 * live public mechanical state, not learned knowledge about the player).
 */

import { BaseConsideration } from '../consideration';
import { WorldFactThresholds } from '../config';
import { ConsiderationContext, ConsiderationMetadata } from '../types';

export interface ActionFreshnessOptions {
  thresholds: WorldFactThresholds;
}

export class ActionFreshnessConsideration extends BaseConsideration {
  readonly metadata: ConsiderationMetadata = {
    id: 'actionFreshness',
    displayName: 'Action Freshness',
    category: 'mechanical',
    version: 1,
    description: 'Slightly favors an action whose declared legalUntil is about to expire, over an equally-good action with no such urgency.',
  };

  constructor(private readonly options: ActionFreshnessOptions) {
    super();
  }

  protected score(ctx: ConsiderationContext): { value: number; reasoning: Record<string, unknown> } {
    if (ctx.action.legalUntil === undefined) {
      return { value: 0.5, reasoning: { reason: 'action has no legalUntil — no urgency signal' } };
    }
    const remainingMs = ctx.action.legalUntil - ctx.now;
    if (remainingMs <= 0) {
      // Already expired by the time we're scoring it — no urgency bonus (should not have been offered as legal, but this consideration never PENALIZES for it; that's the selector's/caller's concern, not this one's).
      return { value: 0.5, reasoning: { remainingMs, reason: 'already expired at evaluation time' } };
    }
    const urgent = remainingMs <= this.options.thresholds.urgentLegalUntilMs;
    const value = urgent ? 0.7 : 0.5;
    return { value, reasoning: { remainingMs, urgent } };
  }
}
