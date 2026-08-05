import { describe, it, expect, beforeEach } from 'vitest';
import { OrchestrationStack } from '../bootstrap';
import { buildTestStack } from './test-stack';
import { buildMatchEvents } from './fixtures';

const PLAYER_ID = 'player-1';
const GAME_ID = 'game-1';

describe('OrchestratingEventProcessor', () => {
  let stack: OrchestrationStack;

  beforeEach(async () => {
    stack = await buildTestStack();
  });

  it('stores events via the inner EventProcessor and does not trigger orchestration without MatchEnded', async () => {
    const matchId = 'match-1';
    const raw = buildMatchEvents(Date.now()).filter((e) => e.type !== 'MatchEnded');

    const result = await stack.orchestratingProcessor.processBatch({ events: raw }, matchId, PLAYER_ID, GAME_ID, '1');

    expect(result.accepted).toBe(raw.length);
    expect(result.rejected).toBe(0);
    expect(result.orchestration).toBeUndefined();

    // Events are durably stored by the inner (real) EventProcessor.
    const { total } = await stack.eventStore.getMatchEvents(matchId);
    expect(total).toBe(raw.length);

    // But the match has not been committed/analyzed yet.
    expect(stack.orchestrator.isCompleted(matchId)).toBe(false);
  });

  it('auto-triggers the full orchestration workflow when a batch contains MatchEnded', async () => {
    const matchId = 'match-2';
    const raw = buildMatchEvents(Date.now());

    const result = await stack.orchestratingProcessor.processBatch({ events: raw }, matchId, PLAYER_ID, GAME_ID, '1');

    expect(result.accepted).toBe(raw.length);
    expect(result.orchestration).toBeDefined();
    expect(result.orchestration!.status).toBe('complete');
    expect(result.orchestration!.matchId).toBe(matchId);
    expect(result.orchestration!.playerModeling!.updated.length).toBeGreaterThan(0);
    expect(result.orchestration!.patternRecognition!.updated.length).toBeGreaterThan(0);

    expect(stack.orchestrator.isCompleted(matchId)).toBe(true);
  });

  it('splits a match across two batches and still auto-completes on the batch containing MatchEnded', async () => {
    const matchId = 'match-3';
    const raw = buildMatchEvents(Date.now());
    const midpoint = Math.floor(raw.length / 2);
    const firstHalf = raw.slice(0, midpoint);
    const secondHalf = raw.slice(midpoint);

    const firstResult = await stack.orchestratingProcessor.processBatch({ events: firstHalf }, matchId, PLAYER_ID, GAME_ID, '1');
    expect(firstResult.orchestration).toBeUndefined();
    expect(firstResult.accepted).toBe(firstHalf.length);

    const secondResult = await stack.orchestratingProcessor.processBatch({ events: secondHalf }, matchId, PLAYER_ID, GAME_ID, '1');
    expect(secondResult.orchestration).toBeDefined();
    expect(secondResult.orchestration!.status).toBe('complete');

    // The committed match record reflects the FULL event count across both batches.
    expect(secondResult.orchestration!.match!.recentEvents.length).toBe(raw.length);
  });

  it('never orchestrates duplicate/rejected events — a resubmitted batch is deduped by the inner processor and orchestration is not re-triggered incorrectly', async () => {
    const matchId = 'match-4';
    const raw = buildMatchEvents(Date.now());

    const first = await stack.orchestratingProcessor.processBatch({ events: raw }, matchId, PLAYER_ID, GAME_ID, '1');
    expect(first.orchestration).toBeDefined();

    // Resubmitting the exact same batch (e.g. a plugin retry after a
    // dropped response) — every event is now a duplicate seq, so nothing
    // new is accepted, and the already-completed match is not reopened.
    const second = await stack.orchestratingProcessor.processBatch({ events: raw }, matchId, PLAYER_ID, GAME_ID, '1');
    expect(second.accepted).toBe(0);
    expect(second.rejected).toBe(raw.length);
    expect(second.orchestration).toBeUndefined();
  });
});
