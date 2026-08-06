import { describe, it, expect } from 'vitest';
import { generatePlayerInsights } from '../player-insights';
import { computeBehaviorEvolution } from '../behavior-evolution';
import { computeConfidenceEvolution } from '../confidence-evolution';
import { buildSemanticDimensionHistory, testConfig, PLAYER_ID, GAME_ID } from './fixtures';
import { PatternEntry, SemanticProfileEntry } from '../types';

describe('generatePlayerInsights — strengths/weaknesses', () => {
  it('classifies a high-value, high-confidence POSITIVE dimension as a strength', () => {
    const profile: SemanticProfileEntry[] = [{ dimension: 'mechanicalSkill', gameId: GAME_ID, value: 0.9, confidence: 0.8, samples: 30 }];
    const result = generatePlayerInsights({ playerId: PLAYER_ID, gameId: GAME_ID, profile, patterns: [] }, 9999, testConfig());
    expect(result.insights.find((i) => i.category === 'strength' && i.subject === 'mechanicalSkill')).toBeDefined();
  });

  it('classifies a low-value POSITIVE dimension as a weakness', () => {
    const profile: SemanticProfileEntry[] = [{ dimension: 'mechanicalSkill', gameId: GAME_ID, value: 0.1, confidence: 0.8, samples: 30 }];
    const result = generatePlayerInsights({ playerId: PLAYER_ID, gameId: GAME_ID, profile, patterns: [] }, 9999, testConfig());
    expect(result.insights.find((i) => i.category === 'weakness' && i.subject === 'mechanicalSkill')).toBeDefined();
  });

  it('a high-value NEGATIVE dimension (e.g. panicThreshold) is a weakness, not a strength', () => {
    const profile: SemanticProfileEntry[] = [{ dimension: 'panicThreshold', gameId: GAME_ID, value: 0.9, confidence: 0.8, samples: 30 }];
    const result = generatePlayerInsights({ playerId: PLAYER_ID, gameId: GAME_ID, profile, patterns: [] }, 9999, testConfig());
    expect(result.insights.find((i) => i.category === 'weakness' && i.subject === 'panicThreshold')).toBeDefined();
    expect(result.insights.find((i) => i.category === 'strength' && i.subject === 'panicThreshold')).toBeUndefined();
  });

  it('an unclassified (no configured polarity) dimension never produces a strength/weakness insight', () => {
    const profile: SemanticProfileEntry[] = [{ dimension: 'favoriteWeapon', gameId: GAME_ID, value: 0.95, confidence: 0.9, samples: 30 }];
    const result = generatePlayerInsights({ playerId: PLAYER_ID, gameId: GAME_ID, profile, patterns: [] }, 9999, testConfig());
    expect(result.insights.filter((i) => i.subject === 'favoriteWeapon')).toEqual([]);
  });

  it('a dimension below insightMinConfidence never produces an insight', () => {
    const profile: SemanticProfileEntry[] = [{ dimension: 'mechanicalSkill', gameId: GAME_ID, value: 0.95, confidence: 0.1, samples: 3 }];
    const result = generatePlayerInsights({ playerId: PLAYER_ID, gameId: GAME_ID, profile, patterns: [] }, 9999, testConfig());
    expect(result.insights.filter((i) => i.subject === 'mechanicalSkill')).toEqual([]);
  });
});

describe('generatePlayerInsights — patterns', () => {
  it('a confirmed pattern in a configured mistake category becomes a recurringMistake', () => {
    const pattern: PatternEntry = { patternId: 'p1', detectorId: 'd', patternKey: 'k', category: 'overextension', state: 'confirmed', confidence: 0.8, description: 'Overextends past the frontline' };
    const config = testConfig({ mistakePatternCategories: ['overextension'] });
    const result = generatePlayerInsights({ playerId: PLAYER_ID, gameId: GAME_ID, profile: [], patterns: [pattern] }, 9999, config);
    expect(result.insights.find((i) => i.category === 'recurringMistake' && i.subject === pattern.description)).toBeDefined();
  });

  it('a confirmed pattern NOT in a configured mistake category is never labeled a recurringMistake', () => {
    const pattern: PatternEntry = { patternId: 'p1', detectorId: 'd', patternKey: 'k', category: 'overextension', state: 'confirmed', confidence: 0.8, description: 'Overextends past the frontline' };
    const result = generatePlayerInsights({ playerId: PLAYER_ID, gameId: GAME_ID, profile: [], patterns: [pattern] }, 9999, testConfig());
    expect(result.insights.filter((i) => i.category === 'recurringMistake')).toEqual([]);
  });

  it('a candidate-state pattern above the confidence threshold becomes an emergingHabit', () => {
    const pattern: PatternEntry = { patternId: 'p2', detectorId: 'd', patternKey: 'k', category: 'movement', state: 'candidate', confidence: 0.6, description: 'Starting to peek right more often' };
    const result = generatePlayerInsights({ playerId: PLAYER_ID, gameId: GAME_ID, profile: [], patterns: [pattern] }, 9999, testConfig());
    expect(result.insights.find((i) => i.category === 'emergingHabit')).toBeDefined();
  });
});

describe('generatePlayerInsights — evolution-derived insights', () => {
  it('a positive dimension trending up becomes an improvingSkill', () => {
    const evolution = computeBehaviorEvolution(buildSemanticDimensionHistory('mechanicalSkill', [0.2, 0.5, 0.8]), PLAYER_ID, 'mechanicalSkill', 9999, testConfig());
    const result = generatePlayerInsights({ playerId: PLAYER_ID, gameId: GAME_ID, profile: [], behaviorEvolutions: [evolution], patterns: [] }, 9999, testConfig());
    expect(result.insights.find((i) => i.category === 'improvingSkill' && i.subject === 'mechanicalSkill')).toBeDefined();
  });

  it('an unclassified dimension trending in either direction is a behaviorChange, not a judged improvement', () => {
    const evolution = computeBehaviorEvolution(buildSemanticDimensionHistory('favoriteWeapon', [0.2, 0.5, 0.8]), PLAYER_ID, 'favoriteWeapon', 9999, testConfig());
    const result = generatePlayerInsights({ playerId: PLAYER_ID, gameId: GAME_ID, profile: [], behaviorEvolutions: [evolution], patterns: [] }, 9999, testConfig());
    expect(result.insights.find((i) => i.category === 'behaviorChange' && i.subject === 'favoriteWeapon')).toBeDefined();
  });

  it('a growing pattern confidence trend becomes a learningTrend', () => {
    const confEvolution = computeConfidenceEvolution([{ timestamp: 1, confidence: 0.3 }, { timestamp: 2, confidence: 0.8 }], PLAYER_ID, 'pattern', 'p1', 9999, testConfig());
    const result = generatePlayerInsights({ playerId: PLAYER_ID, gameId: GAME_ID, profile: [], patterns: [], patternConfidenceEvolutions: [confEvolution] }, 9999, testConfig());
    expect(result.insights.find((i) => i.category === 'learningTrend' && i.subject === 'p1')).toBeDefined();
  });
});

describe('generatePlayerInsights — every insight is evidence-backed', () => {
  it('every insight carries at least one EvidenceRef', () => {
    const profile: SemanticProfileEntry[] = [{ dimension: 'mechanicalSkill', gameId: GAME_ID, value: 0.9, confidence: 0.8, samples: 30 }];
    const pattern: PatternEntry = { patternId: 'p1', detectorId: 'd', patternKey: 'k', category: 'overextension', state: 'confirmed', confidence: 0.8, description: 'x' };
    const config = testConfig({ mistakePatternCategories: ['overextension'] });
    const result = generatePlayerInsights({ playerId: PLAYER_ID, gameId: GAME_ID, profile, patterns: [pattern] }, 9999, config);
    expect(result.insights.length).toBeGreaterThan(0);
    for (const insight of result.insights) expect(insight.evidence.length).toBeGreaterThan(0);
  });
});
