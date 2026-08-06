import { describe, it, expect } from 'vitest';
import { explainStrategy } from '../strategy-explainer';
import { MalformedPlanningTraceError } from '../errors';
import { buildRealStrategicIntent, testConfig } from './fixtures';

describe('explainStrategy', () => {
  it('chosenCandidate matches the real planningTrace entry for the chosen goal', () => {
    const intent = buildRealStrategicIntent();
    const explanation = explainStrategy(intent, testConfig());
    expect(explanation.chosenCandidate.goalId).toBe(intent.goalId);
    const original = intent.planningTrace.candidates.find((c) => c.goalId === intent.goalId);
    expect(explanation.chosenCandidate).toEqual(original);
  });

  it('rejectedAlternatives is exactly planningTrace.rejectedEligible', () => {
    const intent = buildRealStrategicIntent();
    const explanation = explainStrategy(intent, testConfig());
    expect(explanation.rejectedAlternatives).toEqual(intent.planningTrace.rejectedEligible);
  });

  it('confidence.value is exactly strategicIntent.confidence', () => {
    const intent = buildRealStrategicIntent();
    const explanation = explainStrategy(intent, testConfig());
    expect(explanation.confidence.value).toBe(intent.confidence);
  });

  it('throws MalformedPlanningTraceError when the chosen goal has no candidate entry', () => {
    const intent = buildRealStrategicIntent();
    const malformed = { ...intent, planningTrace: { ...intent.planningTrace, candidates: [] } };
    expect(() => explainStrategy(malformed, testConfig())).toThrow(MalformedPlanningTraceError);
  });

  it('is deterministic apart from explanationId', () => {
    const intent = buildRealStrategicIntent();
    const config = testConfig();
    const a = explainStrategy(intent, config);
    const b = explainStrategy(intent, config);
    const { explanationId: idA, ...restA } = a;
    const { explanationId: idB, ...restB } = b;
    expect(idA).not.toBe(idB);
    expect(restA).toEqual(restB);
  });

  it('traceability and naturalLanguage stay index-aligned', () => {
    const intent = buildRealStrategicIntent();
    const explanation = explainStrategy(intent, testConfig());
    expect(explanation.traceability.length).toBe(explanation.naturalLanguage.length);
  });
});
