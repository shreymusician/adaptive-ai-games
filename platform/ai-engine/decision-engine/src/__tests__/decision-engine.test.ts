import { describe, it, expect } from 'vitest';
import { DecisionEngine } from '../decision-engine';
import { DecisionRegistry } from '../registry';
import { BaseConsideration } from '../consideration';
import { NoLegalActionsError, MalformedLegalActionsError, InvalidStrategicIntentError } from '../errors';
import { ConsiderationContext, ConsiderationMetadata } from '../types';
import { baseDecisionInputs, buildAction, buildConfig, buildEngine, buildStrategicIntent } from './fixtures';

/** Busy-waits so each evaluation pass takes measurable wall-clock time — used to force the timeout guard deterministically, without relying on a nonsensical negative budget. */
class SlowConsideration extends BaseConsideration {
  readonly metadata: ConsiderationMetadata = { id: 'slow', displayName: 'Slow', category: 'tactical', version: 1, description: 'busy-waits to force timeout in tests' };
  protected score(_ctx: ConsiderationContext): { value: number; reasoning: Record<string, unknown> } {
    const until = Date.now() + 8;
    while (Date.now() < until) {
      /* busy-wait */
    }
    return { value: 0.5, reasoning: {} };
  }
}

describe('DecisionEngine — decision selection', () => {
  it('selects the higher-utility action when public state clearly favors one', () => {
    const engine = buildEngine();
    const inputs = baseDecisionInputs({
      legalActions: [buildAction('attack', { params: { tags: ['offensive', 'attack'] } }), buildAction('wait', { params: { tags: [] } })],
      publicGameState: { openingAvailable: true },
    });
    const decision = engine.decide(inputs, 1000);
    expect(decision.action.id).toBe('attack');
    expect(decision.score.utility).toBeGreaterThan(0.5);
    expect(decision.alternatives).toHaveLength(2);
    expect(decision.alternatives[0].actionId).toBe('attack');
  });

  it('every field of Decision is populated', () => {
    const engine = buildEngine();
    const decision = engine.decide(baseDecisionInputs(), 1000);
    expect(decision.decisionId).toBeTruthy();
    expect(decision.matchId).toBe('match-1');
    expect(decision.playerId).toBe('player-1');
    expect(decision.gameId).toBe('game-1');
    expect(decision.executionTimestamp).toBe(1000);
    expect(decision.metadata.actionsConsidered).toBe(2);
    expect(decision.reasoningTrace.strategicIntentGoalId).toBe('pressurePlayer');
  });
});

describe('DecisionEngine — tie-breaking', () => {
  it('breaks a genuine utility tie by ascending action id, deterministically', () => {
    const engine = buildEngine();
    const inputs = baseDecisionInputs({ legalActions: [buildAction('zzz'), buildAction('aaa')] });
    const decision = engine.decide(inputs, 1000);
    expect(decision.action.id).toBe('aaa');
    expect(decision.metadata.tieBreak).toBe('deterministic-id-order');
  });

  it('non-tied scoring reports tieBreak "none"', () => {
    const engine = buildEngine();
    const inputs = baseDecisionInputs({
      legalActions: [buildAction('attack', { params: { tags: ['offensive'] } }), buildAction('block', { params: { tags: ['defensive'] } })],
      publicGameState: { selfHealth: 0.1 },
    });
    const decision = engine.decide(inputs, 1000);
    expect(decision.metadata.tieBreak).toBe('none');
  });
});

describe('DecisionEngine — personality', () => {
  it('same facts, different personality, different resulting action', () => {
    const aggressiveEngine = buildEngine();
    const defensiveEngine = buildEngine();
    const legalActions = [buildAction('attack', { params: { tags: ['offensive', 'attack'] } }), buildAction('block', { params: { tags: ['defensive', 'block'] } })];
    const publicGameState = { selfHealth: 0.2, openingAvailable: true };

    const aggressive = aggressiveEngine.decide(baseDecisionInputs({ legalActions, publicGameState, personality: 'aggressive' }), 1000);
    const defensive = defensiveEngine.decide(baseDecisionInputs({ legalActions, publicGameState, personality: 'defensive' }), 1000);

    expect(aggressive.action.id).toBe('attack');
    expect(defensive.action.id).toBe('block');
  });

  it('records the resolved consideration weights actually used', () => {
    const engine = buildEngine();
    const decision = engine.decide(baseDecisionInputs({ personality: 'hunter' }), 1000);
    expect(decision.reasoningTrace.considerationWeights.punishOpening).toBeGreaterThan(0);
    expect(decision.metadata.personality).toBe('hunter');
  });
});

describe('DecisionEngine — failure handling', () => {
  it('throws NoLegalActionsError when the plugin reports no legal actions', () => {
    const engine = buildEngine();
    expect(() => engine.decide(baseDecisionInputs({ legalActions: [] }))).toThrow(NoLegalActionsError);
  });

  it('throws MalformedLegalActionsError when legalActions is not an array', () => {
    const engine = buildEngine();
    expect(() => engine.decide(baseDecisionInputs({ legalActions: { not: 'an array' } as unknown as unknown[] }))).toThrow(MalformedLegalActionsError);
  });

  it('skips individually malformed entries but proceeds with the valid remainder', () => {
    const engine = buildEngine();
    const inputs = baseDecisionInputs({ legalActions: [buildAction('attack'), { bogus: true }, null, 42] as unknown[] });
    const decision = engine.decide(inputs);
    expect(decision.action.id).toBe('attack');
    expect(decision.metadata.actionsSkippedMalformed).toBe(3);
  });

  it('throws InvalidStrategicIntentError for a missing goalId', () => {
    const engine = buildEngine();
    const inputs = baseDecisionInputs({ strategicIntent: buildStrategicIntent({ goalId: '' }) });
    expect(() => engine.decide(inputs)).toThrow(InvalidStrategicIntentError);
  });

  it('throws InvalidStrategicIntentError for an out-of-range confidence', () => {
    const engine = buildEngine();
    const inputs = baseDecisionInputs({ strategicIntent: buildStrategicIntent({ confidence: 1.5 }) });
    expect(() => engine.decide(inputs)).toThrow(InvalidStrategicIntentError);
  });

  it('throws InvalidStrategicIntentError for an unrecognized personality', () => {
    const engine = buildEngine();
    const inputs = baseDecisionInputs({ personality: 'berserker' as never });
    expect(() => engine.decide(inputs)).toThrow(InvalidStrategicIntentError);
  });
});

describe('DecisionEngine — timeout handling', () => {
  it('stops evaluating once the wall-clock budget is exceeded and still returns a deterministic decision', () => {
    const registry = new DecisionRegistry();
    registry.register(() => new SlowConsideration());
    const engine = new DecisionEngine({ registry, config: buildConfig({ maxEvaluationMs: 5 }) });
    const inputs = baseDecisionInputs({ legalActions: [buildAction('a'), buildAction('b'), buildAction('c'), buildAction('d')] });
    const decision = engine.decide(inputs);
    expect(decision.metadata.timedOut).toBe(true);
    expect(decision.metadata.actionsConsidered).toBeGreaterThanOrEqual(1);
    expect(decision.metadata.actionsConsidered).toBeLessThan(4);
  });
});

describe('DecisionEngine — replay determinism', () => {
  it('the same inputs and the same `now` reproduce an identical decision', () => {
    const engine = buildEngine();
    const inputs = baseDecisionInputs({
      legalActions: [buildAction('attack'), buildAction('wait'), buildAction('block')],
      publicGameState: { selfHealth: 0.4, openingAvailable: true },
    });
    const first = engine.decide(inputs, 5000);
    const second = engine.decide(inputs, 5000);
    expect(second.action.id).toBe(first.action.id);
    expect(second.score).toEqual(first.score);
    expect(second.alternatives).toEqual(first.alternatives);
    expect(second.reasoningTrace).toEqual(first.reasoningTrace);
  });

  it('experimental personality exploration is seeded, not wall-clock random: same seed inputs replay identically', () => {
    const engine = buildEngine({ personality: { ...buildConfig().personality, experimental: { ...buildConfig().personality.experimental, explorationEpsilon: 1 } } });
    const inputs = baseDecisionInputs({
      personality: 'experimental',
      legalActions: [buildAction('a'), buildAction('b'), buildAction('c'), buildAction('d')],
    });
    const first = engine.decide(inputs, 9000);
    const second = engine.decide(inputs, 9000);
    expect(second.action.id).toBe(first.action.id);
    expect(first.metadata.tieBreak).toBe('exploration');
  });
});

describe('DecisionEngine — randomized scenarios', () => {
  it('never selects an action outside the legal set, across many randomized inputs', () => {
    const engine = buildEngine();
    const personalities = ['aggressive', 'patient', 'hunter', 'defensive', 'psychological', 'experimental', 'supportive'] as const;
    let seed = 42;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    for (let i = 0; i < 100; i++) {
      const actionCount = 1 + Math.floor(next() * 5);
      const legalActions = Array.from({ length: actionCount }, (_, idx) => buildAction(`action-${idx}`, { params: { tags: next() > 0.5 ? ['offensive'] : ['defensive'] } }));
      const inputs = baseDecisionInputs({
        legalActions,
        personality: personalities[Math.floor(next() * personalities.length)],
        publicGameState: { selfHealth: next(), openingAvailable: next() > 0.5 },
        awarenessBudget: next(),
      });
      const decision = engine.decide(inputs, i * 1000);
      expect(legalActions.map((a) => a.id)).toContain(decision.action.id);
      expect(decision.score.utility).toBeGreaterThanOrEqual(0);
      expect(decision.score.utility).toBeLessThanOrEqual(1);
    }
  });
});

describe('DecisionEngine — performance benchmark', () => {
  it('evaluates a realistic legal-action set well within the tick budget', () => {
    const engine = buildEngine();
    const legalActions = Array.from({ length: 30 }, (_, i) => buildAction(`action-${i}`, { params: { tags: i % 2 === 0 ? ['offensive'] : ['defensive'] } }));
    const inputs = baseDecisionInputs({ legalActions, publicGameState: { selfHealth: 0.5, openingAvailable: true } });

    const start = Date.now();
    for (let i = 0; i < 50; i++) {
      engine.decide(inputs, i);
    }
    const elapsed = Date.now() - start;

    expect(elapsed / 50).toBeLessThan(20);
  });
});
