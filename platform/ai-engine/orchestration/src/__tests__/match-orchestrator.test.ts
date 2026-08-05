import { describe, it, expect, beforeEach } from 'vitest';
import { CanonicalEvent } from '@adaptive-ai/sdk-protocol';
import { OrchestrationStack } from '../bootstrap';
import { buildTestStack } from './test-stack';
import { buildMatchEvents } from './fixtures';
import { MatchAlreadyCompletedError, MatchNeverStartedError } from '../errors';
import { MatchCompletedEvent } from '../types';

const PLAYER_ID = 'player-1';
const GAME_ID = 'game-1';

function toCanonical(matchId: string, raw: ReturnType<typeof buildMatchEvents>[number]): CanonicalEvent {
  return {
    matchId,
    playerId: PLAYER_ID,
    gameId: GAME_ID,
    seq: raw.seq,
    ts: raw.ts,
    type: raw.type as CanonicalEvent['type'],
    payload: raw.payload,
    schemaVersion: '1',
  };
}

async function ingestFullMatch(stack: OrchestrationStack, matchId: string) {
  const raw = buildMatchEvents(Date.now());
  for (const r of raw) {
    stack.orchestrator.ingestEvent(toCanonical(matchId, r));
  }
  return raw;
}

describe('MatchOrchestrator', () => {
  let stack: OrchestrationStack;

  beforeEach(async () => {
    stack = await buildTestStack();
  });

  it('starts working/short-term memory on first ingested event', () => {
    const matchId = 'match-1';
    stack.orchestrator.ingestEvent(toCanonical(matchId, { seq: 1, type: 'MatchStarted', payload: {}, ts: Date.now() }));
    expect(stack.memoryEngine.workingMemory.get(matchId)).not.toBeNull();
    expect(stack.memoryEngine.shortTermMemory.get(matchId)).not.toBeNull();
  });

  it('runs the full deterministic workflow end to end and returns a complete report', async () => {
    const matchId = 'match-2';
    const raw = await ingestFullMatch(stack, matchId);

    const report = await stack.orchestrator.completeMatch(matchId);

    expect(report.status).toBe('complete');
    expect(report.errors).toHaveLength(0);
    expect(report.match).not.toBeNull();
    expect(report.match!.recentEvents.length).toBe(raw.length);
    expect(report.eventCount).toBe(raw.length);

    // Player Modeling actually ran and produced dimension updates.
    expect(report.playerModeling).not.toBeNull();
    expect(report.playerModeling!.updated.length).toBeGreaterThan(0);
    expect(report.playerModeling!.updated.some((u) => u.key === 'aggression')).toBe(true);

    // Pattern Recognition actually ran and produced a pattern from the dodge-direction signal.
    expect(report.patternRecognition).not.toBeNull();
    expect(report.patternRecognition!.updated.some((p) => p.detectorId === 'dodgeDirection' && p.patternKey === 'left')).toBe(true);

    // The updated semantic profile is durably queryable afterward.
    const profile = await stack.memoryEngine.getSemanticProfile(PLAYER_ID, GAME_ID);
    expect(profile.some((d) => d.dimension === 'aggression')).toBe(true);

    // The updated pattern set is durably queryable afterward.
    const { patterns } = await stack.patternStore.search({ playerId: PLAYER_ID, gameId: GAME_ID });
    expect(patterns.some((p) => p.patternId === 'dodgeDirection:left')).toBe(true);
  });

  it('marks the match completed and rejects further ingestion', async () => {
    const matchId = 'match-3';
    await ingestFullMatch(stack, matchId);
    await stack.orchestrator.completeMatch(matchId);

    expect(stack.orchestrator.isCompleted(matchId)).toBe(true);
    expect(() => stack.orchestrator.ingestEvent(toCanonical(matchId, { seq: 999, type: 'PlayerMoved', payload: {}, ts: Date.now() }))).toThrow(MatchAlreadyCompletedError);
  });

  it('rejects completing the same match twice', async () => {
    const matchId = 'match-4';
    await ingestFullMatch(stack, matchId);
    await stack.orchestrator.completeMatch(matchId);
    await expect(stack.orchestrator.completeMatch(matchId)).rejects.toThrow(MatchAlreadyCompletedError);
  });

  it('rejects completing a match that was never started', async () => {
    await expect(stack.orchestrator.completeMatch('never-started')).rejects.toThrow(MatchNeverStartedError);
  });

  it('emits match:completed with the same report returned by completeMatch', async () => {
    const matchId = 'match-5';
    await ingestFullMatch(stack, matchId);

    const emitted: MatchCompletedEvent[] = [];
    stack.orchestrator.on('match:completed', (payload: MatchCompletedEvent) => emitted.push(payload));

    const report = await stack.orchestrator.completeMatch(matchId);

    expect(emitted).toHaveLength(1);
    expect(emitted[0].report.reportId).toBe(report.reportId);
    expect(emitted[0].report.matchId).toBe(matchId);
  });

  it('persists the report via ReportStore once the match:completed listener fires', async () => {
    const matchId = 'match-6';
    await ingestFullMatch(stack, matchId);
    const report = await stack.orchestrator.completeMatch(matchId);

    // The listener wiring in bootstrap.ts is fire-and-forget (a .catch, not
    // awaited) — give the microtask queue one tick to flush the save.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const persisted = await stack.reportStore.getByMatchId(matchId);
    expect(persisted).not.toBeNull();
    expect(persisted!.reportId).toBe(report.reportId);
    expect(persisted!.status).toBe('complete');
  });

  it('records a DecisionPoint event into recentDecisions for Reaction Time to consume', async () => {
    const matchId = 'match-7';
    await ingestFullMatch(stack, matchId);
    const report = await stack.orchestrator.completeMatch(matchId);
    expect(report.match!.recentDecisions.length).toBeGreaterThan(0);
    expect(report.playerModeling!.updated.some((u) => u.key === 'reactionTime')).toBe(true);
  });
});
