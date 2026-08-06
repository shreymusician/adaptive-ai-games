/**
 * explainEpisode — a direct readout of one stored episodic memory
 * (whitepaper §4's Long-Term Episodic Memory). Same caller-gates-visibility
 * convention as pattern-explainer/profile-explainer.
 */

import { randomUUID } from 'node:crypto';
import { confidenceReading } from './confidence';
import { ExplainabilityConfig } from './config';
import { evidence, TraceabilityBuilder } from './evidence';
import { episodeReadoutSentence } from './templates';
import { EpisodeExplanation, PlayerEpisode } from './types';

export function explainEpisode(episode: PlayerEpisode, now: number, config: ExplainabilityConfig): EpisodeExplanation {
  const confidence = confidenceReading(episode.confidence, config.confidenceBuckets);

  const trace = new TraceabilityBuilder();
  trace.add(
    'episode',
    [evidence('episode', episode.episodeId, episode.summary, { episodeType: episode.episodeType, importance: episode.importance, matchId: episode.matchId })],
    episodeReadoutSentence(episode.episodeType, episode.summary, episode.importance, confidence, episode.timestamp)
  );

  const { traceability, naturalLanguage } = trace.build();

  return {
    explanationId: randomUUID(),
    episodeId: episode.episodeId,
    playerId: episode.playerId,
    gameId: episode.gameId,
    matchId: episode.matchId,
    generatedAt: now,
    episodeType: episode.episodeType,
    summary: episode.summary,
    importance: episode.importance,
    confidence,
    timestamp: episode.timestamp,
    traceability,
    naturalLanguage,
    schemaVersion: 1,
  };
}
