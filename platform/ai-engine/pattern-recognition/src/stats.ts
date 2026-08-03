/** Small, dependency-free numeric helpers shared across detectors. Pure functions only. */

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
