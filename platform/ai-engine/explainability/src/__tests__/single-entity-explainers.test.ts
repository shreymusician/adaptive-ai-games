import { describe, it, expect } from 'vitest';
import { explainPattern } from '../pattern-explainer';
import { explainPlayerProfile } from '../profile-explainer';
import { explainEpisode } from '../episode-explainer';
import { buildEpisodes, buildPatterns, buildSemanticProfile, testConfig, PLAYER_ID, GAME_ID } from './fixtures';

describe('explainPattern', () => {
  it('reads out the pattern fields directly, with confidence bucketed from the real value', () => {
    const [pattern] = buildPatterns();
    const explanation = explainPattern(pattern, PLAYER_ID, GAME_ID, 5000, testConfig());
    expect(explanation.patternId).toBe(pattern.patternId);
    expect(explanation.description).toBe(pattern.description);
    expect(explanation.confidence.value).toBe(pattern.confidence);
    expect(explanation.naturalLanguage).toHaveLength(1);
    expect(explanation.traceability).toHaveLength(1);
  });
});

describe('explainPlayerProfile', () => {
  it('reads out every supplied dimension, one traceability entry each', () => {
    const dims = buildSemanticProfile();
    const explanation = explainPlayerProfile(dims, PLAYER_ID, 5000, testConfig());
    expect(explanation.dimensions).toHaveLength(dims.length);
    expect(explanation.traceability).toHaveLength(dims.length);
    expect(explanation.dimensions.map((d) => d.value)).toEqual(dims.map((d) => d.value));
  });

  it('handles an empty dimension list without error', () => {
    const explanation = explainPlayerProfile([], PLAYER_ID, 5000, testConfig());
    expect(explanation.dimensions).toEqual([]);
    expect(explanation.naturalLanguage).toEqual([]);
  });
});

describe('explainEpisode', () => {
  it('reads out the episode fields directly', () => {
    const [episode] = buildEpisodes();
    const explanation = explainEpisode(episode, 5000, testConfig());
    expect(explanation.episodeId).toBe(episode.episodeId);
    expect(explanation.summary).toBe(episode.summary);
    expect(explanation.confidence.value).toBe(episode.confidence);
  });
});
