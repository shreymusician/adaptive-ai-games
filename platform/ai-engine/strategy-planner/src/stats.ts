export function clamp(value: number, min: number = 0, max: number = 1): number {
  return Math.min(max, Math.max(min, value));
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Deterministic string hash (FNV-1a, 32-bit) — used for world-state fingerprinting in plan-cache.ts. Never used for anything security-sensitive. */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/** Deterministic, key-order-independent fingerprint of a flat fact bag. */
export function fingerprintFacts(facts: Readonly<Record<string, boolean | number>>): string {
  const keys = Object.keys(facts).sort();
  const serialized = keys.map((k) => `${k}=${facts[k]}`).join('|');
  return fnv1a(serialized);
}
