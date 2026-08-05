import { describe, it, expect } from 'vitest';
import { PunishOpeningConsideration } from '../../considerations/punish-opening';
import { SafetyConsideration } from '../../considerations/safety';
import { buildAction, makeConsiderationCtx } from '../fixtures';

describe('PunishOpeningConsideration', () => {
  const consideration = new PunishOpeningConsideration();

  it('is neutral when no opening is available, regardless of tags', () => {
    const ctx = makeConsiderationCtx(buildAction('a1', { params: { tags: ['offensive'] } }), { openingAvailable: false });
    expect(consideration.evaluate(ctx).value).toBe(0.5);
  });

  it('strongly favors an offensive action when an opening is available', () => {
    const ctx = makeConsiderationCtx(buildAction('a1', { params: { tags: ['offensive'] } }), { openingAvailable: true });
    expect(consideration.evaluate(ctx).value).toBeGreaterThan(0.7);
  });

  it('disfavors a non-offensive action when an opening is available', () => {
    const ctx = makeConsiderationCtx(buildAction('a1', { params: { tags: ['wait'] } }), { openingAvailable: true });
    expect(consideration.evaluate(ctx).value).toBeLessThan(0.5);
  });
});

describe('SafetyConsideration', () => {
  const consideration = new SafetyConsideration();

  it('is neutral when self health is not low', () => {
    const ctx = makeConsiderationCtx(buildAction('a1', { params: { tags: ['offensive'] } }), { selfHealthLow: false });
    expect(consideration.evaluate(ctx).value).toBe(0.5);
  });

  it('strongly favors a defensive action when self health is low', () => {
    const ctx = makeConsiderationCtx(buildAction('a1', { params: { tags: ['defensive'] } }), { selfHealthLow: true });
    expect(consideration.evaluate(ctx).value).toBeGreaterThan(0.7);
  });

  it('strongly disfavors an offensive action when self health is low', () => {
    const ctx = makeConsiderationCtx(buildAction('a1', { params: { tags: ['offensive'] } }), { selfHealthLow: true });
    expect(consideration.evaluate(ctx).value).toBeLessThan(0.3);
  });

  it('is neutral for an untagged action even when self health is low', () => {
    const ctx = makeConsiderationCtx(buildAction('a1'), { selfHealthLow: true });
    expect(consideration.evaluate(ctx).value).toBe(0.5);
  });
});
