/**
 * Punish Opening — an immediate tactical reaction, independent of the
 * current strategic plan: if the plugin reports a live tactical opening
 * RIGHT NOW (`publicGameState.openingAvailable`), offense-tagged actions
 * become more attractive than they otherwise would be. Distinct from
 * PlanAdherence (which reasons about the multi-step strategic category);
 * this is whitepaper §6's "immediate tactical state" input to the utility
 * sum.
 */

import { BaseConsideration } from '../consideration';
import { ConsiderationContext, ConsiderationMetadata } from '../types';
import { actionTags } from './tags';

const OFFENSIVE_TAGS = ['offensive', 'attack', 'pressure'];

export class PunishOpeningConsideration extends BaseConsideration {
  readonly metadata: ConsiderationMetadata = {
    id: 'punishOpening',
    displayName: 'Punish Opening',
    category: 'tactical',
    version: 1,
    description: 'Favors offense-tagged actions specifically when an immediate tactical opening is currently available.',
  };

  protected score(ctx: ConsiderationContext): { value: number; reasoning: Record<string, unknown> } {
    const openingAvailable = ctx.worldFacts.openingAvailable === true;
    if (!openingAvailable) {
      return { value: 0.5, reasoning: { openingAvailable: false, reason: 'no current opening — no opinion' } };
    }
    const tags = actionTags(ctx.action.params);
    const isOffensive = tags.some((t) => OFFENSIVE_TAGS.includes(t));
    const value = isOffensive ? 0.9 : 0.4;
    return { value, reasoning: { openingAvailable: true, actionTags: tags, isOffensive } };
  }
}
