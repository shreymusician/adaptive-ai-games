/**
 * Safety — self-preservation, independent of strategy or personality: when
 * the AI's own public health is low, defensive-tagged actions become more
 * attractive and offensive-tagged actions less so. Always active,
 * regardless of the current StrategicIntent (even a Retreat-goal plan
 * benefits from this consideration reinforcing the "get to safety" bias at
 * the action level).
 */

import { BaseConsideration } from '../consideration';
import { ConsiderationContext, ConsiderationMetadata } from '../types';
import { actionTags } from './tags';

const DEFENSIVE_TAGS = ['defensive', 'retreat', 'block', 'protect'];
const OFFENSIVE_TAGS = ['offensive', 'attack', 'pressure'];

export class SafetyConsideration extends BaseConsideration {
  readonly metadata: ConsiderationMetadata = {
    id: 'safety',
    displayName: 'Safety',
    category: 'safety',
    version: 1,
    description: "Favors defensive-tagged actions and penalizes offensive-tagged ones when the AI's own public health is low.",
  };

  protected score(ctx: ConsiderationContext): { value: number; reasoning: Record<string, unknown> } {
    const selfHealthLow = ctx.worldFacts.selfHealthLow === true;
    if (!selfHealthLow) {
      return { value: 0.5, reasoning: { selfHealthLow: false, reason: 'no safety concern right now' } };
    }
    const tags = actionTags(ctx.action.params);
    const isDefensive = tags.some((t) => DEFENSIVE_TAGS.includes(t));
    const isOffensive = tags.some((t) => OFFENSIVE_TAGS.includes(t));
    let value = 0.5;
    if (isDefensive) value = 0.9;
    else if (isOffensive) value = 0.15;
    return { value, reasoning: { selfHealthLow: true, actionTags: tags, isDefensive, isOffensive } };
  }
}
