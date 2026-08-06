/**
 * generatePlayerInsights — strengths / weaknesses / improving skills /
 * recurring mistakes / emerging habits / behavior changes / learning
 * trends, whitepaper §8. Every single insight traces back to a real
 * semantic-profile value, pattern entry, or stored trend computation —
 * never a subjective judgment invented on the spot. A dimension this
 * package's config doesn't classify (see config.ts's `dimensionPolarity`
 * doc comment) never produces a strength/weakness insight; a pattern
 * category not declared in `mistakePatternCategories` never produces a
 * recurringMistake insight. Silence, not a guess, is the correct behavior
 * when there's no evidence-backed classification available.
 */

import { ExplainabilityConfig } from './config';
import { confidenceReading } from './confidence';
import { evidence, TraceabilityBuilder } from './evidence';
import { insightSentence } from './templates';
import { BehaviorEvolution, ConfidenceEvolution, PatternEntry, PlayerInsight, PlayerInsights, SemanticProfileEntry } from './types';

export interface PlayerInsightsInputs {
  playerId: string;
  gameId: string | null;
  profile: SemanticProfileEntry[];
  behaviorEvolutions?: BehaviorEvolution[];
  patterns: PatternEntry[];
  patternConfidenceEvolutions?: ConfidenceEvolution[];
}

export function generatePlayerInsights(inputs: PlayerInsightsInputs, now: number, config: ExplainabilityConfig): PlayerInsights {
  const insights: PlayerInsight[] = [];
  const trace = new TraceabilityBuilder();

  const sortedProfile = [...inputs.profile].sort((a, b) => a.dimension.localeCompare(b.dimension));
  for (const d of sortedProfile) {
    const polarity = config.dimensionPolarity[d.dimension];
    if (!polarity) continue;
    if (d.confidence < config.insightMinConfidence) continue;

    const confidence = confidenceReading(d.confidence, config.confidenceBuckets);
    const isHigh = d.value >= config.insightValueThreshold;
    const isLow = d.value <= 1 - config.insightValueThreshold;
    const ev = [evidence('semanticDimension', d.dimension, d.dimension, { value: d.value, samples: d.samples })];

    if ((polarity === 'positive' && isHigh) || (polarity === 'negative' && isLow)) {
      const insight: PlayerInsight = { category: 'strength', subject: d.dimension, detail: { value: d.value, samples: d.samples }, confidence, evidence: ev };
      insights.push(insight);
      trace.add(`insights.strength.${d.dimension}`, ev, insightSentence('strength', d.dimension, confidence));
    } else if ((polarity === 'positive' && isLow) || (polarity === 'negative' && isHigh)) {
      const insight: PlayerInsight = { category: 'weakness', subject: d.dimension, detail: { value: d.value, samples: d.samples }, confidence, evidence: ev };
      insights.push(insight);
      trace.add(`insights.weakness.${d.dimension}`, ev, insightSentence('weakness', d.dimension, confidence));
    }
  }

  const sortedEvolutions = [...(inputs.behaviorEvolutions ?? [])].sort((a, b) => a.dimension.localeCompare(b.dimension));
  for (const be of sortedEvolutions) {
    if (be.direction === 'stable') continue;
    const polarity = config.dimensionPolarity[be.dimension];
    const trendingGood = polarity === 'positive' ? be.direction === 'increasing' : polarity === 'negative' ? be.direction === 'decreasing' : null;
    const confidence = confidenceReading(1, config.confidenceBuckets); // trend itself is a plain fact of stored history, not a probabilistic claim — reported at full confidence
    const ev = [evidence('semanticDimension', `${be.dimension}:trend`, be.dimension, { firstValue: be.firstValue, lastValue: be.lastValue, direction: be.direction })];

    const category = trendingGood === true ? 'improvingSkill' : 'behaviorChange';
    const insight: PlayerInsight = { category, subject: be.dimension, detail: { direction: be.direction, delta: be.delta, sampleCount: be.sampleCount }, confidence, evidence: ev };
    insights.push(insight);
    trace.add(`insights.${category}.${be.dimension}`, ev, insightSentence(category, be.dimension, confidence));
  }

  const sortedPatterns = [...inputs.patterns].sort((a, b) => a.patternId.localeCompare(b.patternId));
  for (const p of sortedPatterns) {
    const confidence = confidenceReading(p.confidence, config.confidenceBuckets);
    const ev = [evidence('pattern', p.patternId, p.description, { category: p.category, state: p.state })];

    if (config.mistakePatternCategories.includes(p.category) && (p.state === 'confirmed' || p.state === 'strong')) {
      const insight: PlayerInsight = { category: 'recurringMistake', subject: p.description, detail: { patternId: p.patternId, category: p.category, state: p.state }, confidence, evidence: ev };
      insights.push(insight);
      trace.add(`insights.recurringMistake.${p.patternId}`, ev, insightSentence('recurringMistake', p.description, confidence));
    } else if (p.state === 'candidate' && p.confidence >= config.insightMinConfidence) {
      const insight: PlayerInsight = { category: 'emergingHabit', subject: p.description, detail: { patternId: p.patternId, category: p.category, state: p.state }, confidence, evidence: ev };
      insights.push(insight);
      trace.add(`insights.emergingHabit.${p.patternId}`, ev, insightSentence('emergingHabit', p.description, confidence));
    }
  }

  const sortedConfEvolutions = [...(inputs.patternConfidenceEvolutions ?? [])].sort((a, b) => a.subjectId.localeCompare(b.subjectId));
  for (const ce of sortedConfEvolutions) {
    if (ce.direction !== 'increasing') continue;
    const ev = [evidence('pattern', `${ce.subjectId}:confidenceTrend`, ce.subjectId, { firstConfidence: ce.firstConfidence.value, lastConfidence: ce.lastConfidence.value })];
    const insight: PlayerInsight = { category: 'learningTrend', subject: ce.subjectId, detail: { firstConfidence: ce.firstConfidence.value, lastConfidence: ce.lastConfidence.value }, confidence: ce.lastConfidence, evidence: ev };
    insights.push(insight);
    trace.add(`insights.learningTrend.${ce.subjectId}`, ev, insightSentence('learningTrend', ce.subjectId, ce.lastConfidence));
  }

  const { traceability, naturalLanguage } = trace.build();

  return {
    explanationId: `player-insights:${inputs.playerId}:${inputs.gameId ?? 'cross-game'}`,
    playerId: inputs.playerId,
    gameId: inputs.gameId,
    generatedAt: now,
    insights,
    traceability,
    naturalLanguage,
    schemaVersion: 1,
  };
}
