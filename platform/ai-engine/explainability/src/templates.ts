/**
 * Deterministic template-fill — ADAPTIVE_AI_ENGINE_WHITEPAPER.md §8:
 * "a deterministic template-fill sourced directly from the stored Decision
 * trace — never a post-hoc generative explanation step." Every function
 * here is a PURE string formatter over already-computed structured values;
 * none of them make a judgment call, invent a reason, or read any field not
 * passed to them explicitly. No natural-language sentence in this package
 * is ever produced anywhere except through one of these functions.
 */

import { ConfidenceReading, GoalCategory, TrendDirection } from './types';

const pct = (n: number): string => `${Math.round(n * 100)}%`;
const num = (n: number, decimals = 2): string => n.toFixed(decimals);

export function confidencePhrase(c: ConfidenceReading): string {
  return `${c.level} confidence (${num(c.value)})`;
}

// --- Decision Explanation -------------------------------------------------

export function decisionSummarySentence(actionId: string, goalDisplayName: string, category: GoalCategory, utility: number): string {
  return `Chose action "${actionId}" in pursuit of "${goalDisplayName}" (${category}); utility ${num(utility)}.`;
}

export function primaryReasonSentence(considerationId: string, weight: number, value: number, contribution: number): string {
  return `The strongest factor was "${considerationId}" (weight ${num(weight)} × value ${num(value)} = ${num(contribution)}).`;
}

export function supportingEvidenceSentence(items: Array<{ considerationId: string; value: number }>): string {
  if (items.length === 0) return 'No other considerations contributed meaningfully to this decision.';
  const list = items.map((i) => `${i.considerationId} (${num(i.value)})`).join(', ');
  return `Supporting factors: ${list}.`;
}

export function alternativesSentence(alternatives: Array<{ actionId: string; utilityGapFromWinner: number }>): string {
  if (alternatives.length === 0) return 'No other legal actions were available.';
  const closest = alternatives[0];
  return `${alternatives.length} alternative action(s) were considered; the closest was "${closest.actionId}", ${num(closest.utilityGapFromWinner)} utility lower.`;
}

export function patternsUsedSentence(patterns: Array<{ description: string; confidence: ConfidenceReading }>): string {
  if (patterns.length === 0) return 'No confirmed behavioral patterns influenced this decision.';
  const list = patterns.map((p) => `"${p.description}" (${confidencePhrase(p.confidence)})`).join('; ');
  return `Drew on ${patterns.length} known pattern(s): ${list}.`;
}

export function playerTraitsSentence(traits: Array<{ dimension: string; value: number; confidence: ConfidenceReading }>): string {
  if (traits.length === 0) return 'No player-profile traits influenced this decision.';
  const list = traits.map((t) => `${t.dimension}=${num(t.value)} (${confidencePhrase(t.confidence)})`).join('; ');
  return `Drew on player traits: ${list}.`;
}

export function memoriesReferencedSentence(memories: Array<{ summary: string }>): string {
  if (memories.length === 0) return 'No specific past encounters were recalled for this decision.';
  const list = memories.map((m) => `"${m.summary}"`).join('; ');
  return `Recalled ${memories.length} past encounter(s): ${list}.`;
}

export function confidenceSentence(c: ConfidenceReading): string {
  return `Overall decision confidence: ${confidencePhrase(c)}.`;
}

export function awarenessTierSentence(tier: string): string {
  return `Awareness tier at decision time: ${tier}.`;
}

// --- Strategy Explanation ---------------------------------------------------

export function strategyChosenSentence(goalId: string, goalCategory: GoalCategory, utility: number, cost: number): string {
  return `Selected goal "${goalId}" (${goalCategory}); utility ${num(utility)}, cost ${num(cost)}.`;
}

export function strategyRejectedSentence(rejected: Array<{ goalId: string; score: number }>): string {
  if (rejected.length === 0) return 'No other eligible goals were available this planning pass.';
  const list = rejected.map((r) => `${r.goalId} (score ${num(r.score)})`).join(', ');
  return `${rejected.length} eligible alternative goal(s) were not chosen: ${list}.`;
}

export function plannedSequenceSentence(sequence: string[]): string {
  if (sequence.length === 0) return 'No further goals are planned beyond the current one.';
  return `Planned to follow with: ${sequence.join(' -> ')}.`;
}

// --- Pattern Explanation -----------------------------------------------------

export function patternReadoutSentence(description: string, category: string, state: string, confidence: ConfidenceReading): string {
  return `I've noticed: ${description} (category: ${category}, state: ${state}, ${confidencePhrase(confidence)}).`;
}

// --- Player Profile Explanation ----------------------------------------------

export function profileDimensionSentence(dimension: string, value: number, confidence: ConfidenceReading, samples: number): string {
  return `${dimension}: ${num(value)} (${confidencePhrase(confidence)}, ${samples} sample(s)).`;
}

// --- Episode Explanation -------------------------------------------------------

export function episodeReadoutSentence(episodeType: string, summary: string, importance: number, confidence: ConfidenceReading, timestamp: number): string {
  return `[${new Date(timestamp).toISOString()}] (${episodeType}, importance ${num(importance)}, ${confidencePhrase(confidence)}): ${summary}.`;
}

// --- Match Summary ---------------------------------------------------------

export function matchOverviewSentence(decisionCount: number, personality: string | null, averageUtility: number, averageConfidence: ConfidenceReading): string {
  const p = personality ? ` with ${personality} personality` : '';
  return `Made ${decisionCount} decision(s) this match${p}; average utility ${num(averageUtility)}, average ${confidencePhrase(averageConfidence)}.`;
}

export function goalBreakdownSentence(breakdown: Array<{ category: GoalCategory; count: number }>): string {
  if (breakdown.length === 0) return 'No goal categories were pursued this match.';
  const list = breakdown.map((b) => `${b.category}: ${b.count}`).join(', ');
  return `Goal category breakdown: ${list}.`;
}

export function keyMomentsSentence(label: string, moments: Array<{ actionId: string; utility: number }>): string {
  if (moments.length === 0) return `No ${label} decisions were recorded.`;
  const list = moments.map((m) => `"${m.actionId}" (utility ${num(m.utility)})`).join(', ');
  return `${label[0].toUpperCase()}${label.slice(1)}: ${list}.`;
}

// --- Behavior / Confidence Evolution -----------------------------------------

export function behaviorEvolutionSentence(dimension: string, direction: TrendDirection, first: number, last: number, sampleCount: number): string {
  if (direction === 'stable') return `${dimension} has stayed stable at around ${num(last)} across ${sampleCount} observation(s).`;
  const verb = direction === 'increasing' ? 'increased' : 'decreased';
  return `${dimension} has ${verb} from ${num(first)} to ${num(last)} across ${sampleCount} observation(s).`;
}

export function confidenceEvolutionSentence(subjectKind: string, subjectId: string, direction: TrendDirection, first: ConfidenceReading, last: ConfidenceReading): string {
  if (direction === 'stable') return `Confidence in ${subjectKind} "${subjectId}" has remained stable (${confidencePhrase(last)}).`;
  const verb = direction === 'increasing' ? 'grown' : 'declined';
  return `Confidence in ${subjectKind} "${subjectId}" has ${verb} from ${confidencePhrase(first)} to ${confidencePhrase(last)}.`;
}

// --- Match Comparison ---------------------------------------------------------

export function dimensionComparisonSentence(dimension: string, before: number, after: number, direction: TrendDirection): string {
  if (direction === 'stable') return `${dimension} is essentially unchanged (${num(before)} -> ${num(after)}).`;
  const verb = direction === 'increasing' ? 'more' : 'less';
  return `You have become ${verb} ${dimension}-oriented: ${num(before)} -> ${num(after)}.`;
}

export function decisionCountDeltaSentence(delta: number): string {
  if (delta === 0) return 'The decision count was the same across both matches.';
  const verb = delta > 0 ? 'more' : 'fewer';
  return `${Math.abs(delta)} ${verb} decisions were made in the later match.`;
}

// --- Player Insights -----------------------------------------------------------

export function insightSentence(category: string, subject: string, confidence: ConfidenceReading): string {
  return `${category}: ${subject} (${confidencePhrase(confidence)}).`;
}

export { pct, num };
