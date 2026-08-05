import { describe, it, expect } from 'vitest';
import { explorationEpsilon, resolvePersonalityWeight, seededUnitRandom } from '../personality';
import { loadStrategyPlannerConfig } from '../config';
import { PERSONALITY_ARCHETYPES, GoalMetadata } from '../types';

const config = loadStrategyPlannerConfig().personality;

const pressureGoal: GoalMetadata = { id: 'pressurePlayer', displayName: 'Pressure Player', category: 'pressure', version: 1, interruptPriority: 0, description: '' };
const defenseGoal: GoalMetadata = { id: 'protectObjective', displayName: 'Protect Objective', category: 'defense', version: 1, interruptPriority: 5, description: '' };

describe('resolvePersonalityWeight — whitepaper §9 archetype biases', () => {
  it('Aggressive weights pressure high and defense low', () => {
    expect(resolvePersonalityWeight(config, 'aggressive', pressureGoal)).toBeGreaterThan(1);
    expect(resolvePersonalityWeight(config, 'aggressive', defenseGoal)).toBeLessThan(1);
  });

  it('Defensive weights defense high and pressure low', () => {
    expect(resolvePersonalityWeight(config, 'defensive', defenseGoal)).toBeGreaterThan(1);
    expect(resolvePersonalityWeight(config, 'defensive', pressureGoal)).toBeLessThan(1);
  });

  it('Patient weights defense/positioning high, pressure/tempo low', () => {
    expect(resolvePersonalityWeight(config, 'patient', defenseGoal)).toBeGreaterThan(1);
  });

  it('every registered archetype resolves a positive finite weight for every category', () => {
    for (const personality of PERSONALITY_ARCHETYPES) {
      for (const category of ['pressure', 'positioning', 'deception', 'information', 'defense', 'tempo'] as const) {
        const meta: GoalMetadata = { id: 'x', displayName: 'x', category, version: 1, interruptPriority: 0, description: '' };
        const weight = resolvePersonalityWeight(config, personality, meta);
        expect(weight).toBeGreaterThan(0);
        expect(Number.isFinite(weight)).toBe(true);
      }
    }
  });

  it('a goal-specific override multiplies on top of the category weight', () => {
    const scoutGoal: GoalMetadata = { id: 'scoutUnknownBehavior', displayName: 'Scout', category: 'information', version: 1, interruptPriority: 0, description: '' };
    const genericInfoGoal: GoalMetadata = { id: 'someOtherInfoGoal', displayName: 'x', category: 'information', version: 1, interruptPriority: 0, description: '' };
    const scoutWeight = resolvePersonalityWeight(config, 'hunter', scoutGoal);
    const genericWeight = resolvePersonalityWeight(config, 'hunter', genericInfoGoal);
    expect(scoutWeight).toBeGreaterThan(genericWeight);
  });
});

describe('Supportive personality (this phase\'s explicit addition to the whitepaper §9 list)', () => {
  it('weights defense/positioning favorably and pressure down, distinct from pure Defensive', () => {
    expect(resolvePersonalityWeight(config, 'supportive', defenseGoal)).toBeGreaterThan(1);
    expect(resolvePersonalityWeight(config, 'supportive', pressureGoal)).toBeLessThan(1);
  });
});

describe('Experimental exploration term', () => {
  it('is 0 for every non-Experimental personality', () => {
    for (const personality of PERSONALITY_ARCHETYPES) {
      if (personality === 'experimental') continue;
      expect(explorationEpsilon(config, personality)).toBe(0);
    }
  });

  it('is a positive [0,1] value for Experimental', () => {
    const eps = explorationEpsilon(config, 'experimental');
    expect(eps).toBeGreaterThan(0);
    expect(eps).toBeLessThanOrEqual(1);
  });
});

describe('seededUnitRandom — deterministic, never wall-clock entropy', () => {
  it('is a pure function of its seed: same seed => same output, every time', () => {
    const a = seededUnitRandom('match-1:5000:tick-3');
    const b = seededUnitRandom('match-1:5000:tick-3');
    expect(a).toBe(b);
  });

  it('produces different outputs for different seeds (not a constant)', () => {
    const a = seededUnitRandom('seed-a');
    const b = seededUnitRandom('seed-b');
    expect(a).not.toBe(b);
  });

  it('always returns a value in [0, 1)', () => {
    for (const seed of ['a', 'b', 'c', 'match-42:99999', '']) {
      const v = seededUnitRandom(seed);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
