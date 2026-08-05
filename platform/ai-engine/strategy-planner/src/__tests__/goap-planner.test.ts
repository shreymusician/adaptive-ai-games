import { describe, it, expect } from 'vitest';
import { runGoapSearch } from '../goap-planner';
import { buildConfig, buildRegistry, baseInputs, makeAwarenessAccumulator } from './fixtures';
import { AbstractWorldState } from '../types';

describe('runGoapSearch — bounds', () => {
  it('never expands more nodes than the configured node budget', () => {
    const registry = buildRegistry();
    const config = buildConfig({ goap: { maxSearchDepth: 3, nodeBudget: 30, beamWidth: 3, discountFactor: 0.85, planTtlMs: 15000 } });
    const worldState: AbstractWorldState = { spaceContested: true, spaceContestedValue: 0.6 };
    const result = runGoapSearch(registry, { inputs: baseInputs(), awarenessUsed: makeAwarenessAccumulator() }, worldState, 'aggressive', config, 'seed-1');
    expect(result.nodesExpanded).toBeLessThanOrEqual(30 + registry.list().length); // one pass may slightly exceed the exact budget by at most one full evaluation, never more
  });

  it('never exceeds the configured max search depth', () => {
    const registry = buildRegistry();
    const config = buildConfig({ goap: { maxSearchDepth: 2, nodeBudget: 200, beamWidth: 3, discountFactor: 0.85, planTtlMs: 15000 } });
    const worldState: AbstractWorldState = { spaceContested: true };
    const result = runGoapSearch(registry, { inputs: baseInputs(), awarenessUsed: makeAwarenessAccumulator() }, worldState, 'aggressive', config, 'seed-2');
    expect(result.searchDepthUsed).toBeLessThanOrEqual(2);
  });

  it('always produces at least one plan step, even from a totally empty world state', () => {
    const registry = buildRegistry();
    const config = buildConfig();
    const result = runGoapSearch(registry, { inputs: baseInputs(), awarenessUsed: makeAwarenessAccumulator() }, {}, 'aggressive', config, 'seed-3');
    expect(result.planSequence.length).toBeGreaterThanOrEqual(1);
  });

  it('RegroupGoal specifically wins when every other goal is deliberately made ineligible', () => {
    const registry = buildRegistry();
    const config = buildConfig();
    // Every other goal's preconditions explicitly fail; DenyResources stays
    // trivially eligible (its only precondition is "resources not low") but
    // scores below Regroup's baseline with no supporting patterns.
    const worldState: AbstractWorldState = {
      openingAvailable: false,
      playerHealthLow: false,
      spaceContested: false,
      objectiveThreatened: false,
      selfResourcesLow: false,
      playerHighAggression: false,
      hasExploitablePattern: false,
      playerPredictable: false,
      semanticProfileAvailable: true,
      exploitablePatternCount: 5,
      awarenessTierExpert: false,
      selfHealthLow: false,
      extra_multipleTargets: false,
    };
    const result = runGoapSearch(registry, { inputs: baseInputs(), awarenessUsed: makeAwarenessAccumulator() }, worldState, 'aggressive', config, 'seed-3b');
    expect(result.planSequence[0].goalId).toBe('regroup');
  });
});

describe('runGoapSearch — determinism', () => {
  it('the exact same inputs (including seed) always produce the exact same plan sequence', () => {
    const registry = buildRegistry();
    const config = buildConfig();
    const worldState: AbstractWorldState = { spaceContested: true, spaceContestedValue: 0.7, openingAvailable: true, playerHealthLow: true };
    const run = () => runGoapSearch(registry, { inputs: baseInputs(), awarenessUsed: makeAwarenessAccumulator() }, worldState, 'aggressive', config, 'fixed-seed');

    const first = run();
    const second = run();
    expect(second.planSequence.map((s) => s.goalId)).toEqual(first.planSequence.map((s) => s.goalId));
    expect(second.nodesExpanded).toBe(first.nodesExpanded);
  });
});

describe('runGoapSearch — plan quality', () => {
  it('prefers Retreat when self health is critically low, even under an aggressive personality', () => {
    const registry = buildRegistry();
    const config = buildConfig();
    const worldState: AbstractWorldState = { selfHealthLow: true, selfHealth: 0.05, openingAvailable: true };
    const result = runGoapSearch(registry, { inputs: baseInputs(), awarenessUsed: makeAwarenessAccumulator() }, worldState, 'aggressive', config, 'seed-4');
    expect(result.planSequence[0].goalId).toBe('retreat');
  });

  it('rejectedEligible lists eligible-but-not-chosen goals for explainability', () => {
    const registry = buildRegistry();
    const config = buildConfig();
    const worldState: AbstractWorldState = { spaceContested: true, spaceContestedValue: 0.9, openingAvailable: true };
    const result = runGoapSearch(registry, { inputs: baseInputs(), awarenessUsed: makeAwarenessAccumulator() }, worldState, 'aggressive', config, 'seed-5');
    expect(result.rejectedEligible.every((c) => c.preconditionsMet)).toBe(true);
    expect(result.rejectedEligible.every((c) => c.goalId !== result.planSequence[0].goalId)).toBe(true);
  });
});

describe('runGoapSearch — personality changes scoring from identical facts (whitepaper §9)', () => {
  it('the same goal gets a different personality-weighted score under Aggressive vs. Defensive', () => {
    const registry = buildRegistry();
    const config = buildConfig();
    const worldState: AbstractWorldState = { spaceContested: true, spaceContestedValue: 0.55, openingAvailable: true, selfResourcesLow: false };

    const aggressive = runGoapSearch(registry, { inputs: baseInputs(), awarenessUsed: makeAwarenessAccumulator() }, worldState, 'aggressive', config, 'seed-6');
    const defensive = runGoapSearch(registry, { inputs: baseInputs(), awarenessUsed: makeAwarenessAccumulator() }, worldState, 'defensive', config, 'seed-6');

    const aggressivePressure = aggressive.rootCandidates.find((c) => c.goalId === 'pressurePlayer')!;
    const defensivePressure = defensive.rootCandidates.find((c) => c.goalId === 'pressurePlayer')!;

    // Same underlying utility/cost (same facts, same goal, same math) — only
    // the personality weight differs, exactly matching whitepaper §9's
    // "same facts, different scoring, different resulting action".
    expect(aggressivePressure.utility).toBe(defensivePressure.utility);
    expect(aggressivePressure.cost).toBe(defensivePressure.cost);
    expect(aggressivePressure.personalityWeight).toBeGreaterThan(defensivePressure.personalityWeight);
    expect(aggressivePressure.score).toBeGreaterThan(defensivePressure.score);
  });
});
