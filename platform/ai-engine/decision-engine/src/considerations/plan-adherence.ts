/**
 * Plan Adherence — favors legal actions that align with the current
 * StrategicIntent's category. Genre-agnostic by construction: a plugin
 * OPTS IN to this consideration having an opinion by tagging its actions
 * (`action.params.tags: string[]`) with abstract category labels — the
 * same "opt-in genre-specific field, never defaulted to a value" convention
 * Pattern Recognition's detectors already establish for payload fields. An
 * action with no `tags` (or a plugin that never populates them at all)
 * simply never triggers an opinion from this consideration — 0.5, neutral,
 * never a penalty for a plugin that hasn't adopted the convention.
 */

import { BaseConsideration } from '../consideration';
import { ConsiderationContext, ConsiderationMetadata, GoalCategory } from '../types';
import { actionTags } from './tags';

const CATEGORY_TAGS: Record<GoalCategory, string[]> = {
  pressure: ['offensive', 'attack', 'pressure'],
  positioning: ['move', 'reposition', 'position'],
  deception: ['feint', 'fake', 'ambush', 'deceive'],
  information: ['scout', 'wait', 'observe'],
  defense: ['defensive', 'retreat', 'block', 'protect'],
  tempo: ['delay', 'conserve', 'wait'],
};

export class PlanAdherenceConsideration extends BaseConsideration {
  readonly metadata: ConsiderationMetadata = {
    id: 'planAdherence',
    displayName: 'Plan Adherence',
    category: 'planAdherence',
    version: 1,
    description: "Favors actions tagged consistently with the current StrategicIntent's category.",
  };

  protected score(ctx: ConsiderationContext): { value: number; reasoning: Record<string, unknown> } {
    const tags = actionTags(ctx.action.params);
    if (tags.length === 0) {
      return { value: 0.5, reasoning: { reason: 'action declares no tags — no opinion', goalCategory: ctx.inputs.strategicIntent.category } };
    }
    const preferred = CATEGORY_TAGS[ctx.inputs.strategicIntent.category] ?? [];
    const matches = tags.filter((t) => preferred.includes(t));
    const value = matches.length > 0 ? 0.5 + Math.min(0.4, matches.length * 0.2) : 0.3;
    return { value, reasoning: { goalCategory: ctx.inputs.strategicIntent.category, actionTags: tags, matchedTags: matches } };
  }
}
