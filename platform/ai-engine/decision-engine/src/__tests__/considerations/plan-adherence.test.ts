import { describe, it, expect } from 'vitest';
import { PlanAdherenceConsideration } from '../../considerations/plan-adherence';
import { buildAction, buildStrategicIntent, makeConsiderationCtx } from '../fixtures';

describe('PlanAdherenceConsideration', () => {
  const consideration = new PlanAdherenceConsideration();

  it('is neutral (0.5) for an action with no tags', () => {
    const ctx = makeConsiderationCtx(buildAction('a1'), {}, { strategicIntent: buildStrategicIntent({ category: 'pressure' }) });
    expect(consideration.evaluate(ctx).value).toBe(0.5);
  });

  it('scores above neutral when the action is tagged consistently with the intent category', () => {
    const ctx = makeConsiderationCtx(buildAction('a1', { params: { tags: ['offensive'] } }), {}, { strategicIntent: buildStrategicIntent({ category: 'pressure' }) });
    expect(consideration.evaluate(ctx).value).toBeGreaterThan(0.5);
  });

  it('scores below neutral when tagged but inconsistent with the intent category', () => {
    const ctx = makeConsiderationCtx(buildAction('a1', { params: { tags: ['defensive'] } }), {}, { strategicIntent: buildStrategicIntent({ category: 'pressure' }) });
    expect(consideration.evaluate(ctx).value).toBeLessThan(0.5);
  });

  it('scores higher with more matching tags than fewer', () => {
    const one = consideration.evaluate(makeConsiderationCtx(buildAction('a1', { params: { tags: ['offensive'] } }), {}, { strategicIntent: buildStrategicIntent({ category: 'pressure' }) }));
    const two = consideration.evaluate(makeConsiderationCtx(buildAction('a1', { params: { tags: ['offensive', 'attack'] } }), {}, { strategicIntent: buildStrategicIntent({ category: 'pressure' }) }));
    expect(two.value).toBeGreaterThan(one.value);
  });

  it('never returns outside [0,1] regardless of tag count', () => {
    const many = buildAction('a1', { params: { tags: ['offensive', 'attack', 'pressure', 'offensive', 'attack'] } });
    const ctx = makeConsiderationCtx(many, {}, { strategicIntent: buildStrategicIntent({ category: 'pressure' }) });
    const value = consideration.evaluate(ctx).value;
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  });
});
