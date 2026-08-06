/**
 * Confidence bucketing — whitepaper §8: "Every explanation must indicate
 * confidence ... Confidence must come from actual reasoning confidence.
 * Never fabricate certainty." This file's only job is mapping an already-
 * real numeric confidence (never computed or estimated here) into one of
 * three human-readable buckets, deterministically.
 */

import { ConfidenceBucketConfig } from './config';
import { ConfidenceLevel, ConfidenceReading } from './types';

export function confidenceLevel(value: number, config: ConfidenceBucketConfig): ConfidenceLevel {
  if (value < config.lowMax) return 'low';
  if (value < config.mediumMax) return 'medium';
  return 'high';
}

export function confidenceReading(value: number, config: ConfidenceBucketConfig): ConfidenceReading {
  return { value, level: confidenceLevel(value, config) };
}
