/** Small, dependency-free numeric helpers shared across analyzers. Pure functions only — no I/O, no analyzer-specific interpretation. */

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return mean(values.map((v) => (v - m) ** 2));
}

/** Shannon entropy in bits over a category-count map. 0 for an empty or single-category distribution. */
export function entropy(counts: Map<string, number>): number {
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  let h = 0;
  for (const count of counts.values()) {
    if (count === 0) continue;
    const p = count / total;
    h -= p * Math.log2(p);
  }
  return h;
}

/** Entropy normalized to [0,1] by the maximum possible entropy for the observed number of distinct categories (log2(distinctCategories)). 0 distinct or 1 distinct categories both normalize to 0 (no uncertainty). */
export function normalizedEntropy(counts: Map<string, number>): number {
  const distinct = counts.size;
  if (distinct <= 1) return 0;
  return entropy(counts) / Math.log2(distinct);
}

/** Clamps a value into [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
