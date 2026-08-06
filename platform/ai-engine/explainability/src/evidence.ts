/**
 * Shared EvidenceRef / TraceabilityMap builders — every explainer in this
 * package uses these instead of constructing evidence objects ad hoc, so
 * the shape stays uniform across all ten explanation types (whitepaper §8:
 * "the mapping should be recoverable programmatically").
 */

import { EvidenceKind, EvidenceRef, TraceabilityEntry, TraceabilityMap } from './types';

export function evidence(kind: EvidenceKind, id: string, label: string, detail: Record<string, unknown> = {}): EvidenceRef {
  return { kind, id, label, detail };
}

export function traceEntry(claim: string, refs: EvidenceRef[]): TraceabilityEntry {
  return { claim, evidence: refs };
}

/** Small builder collecting (claim, evidence[]) pairs in call order — used by every explainer to accumulate its TraceabilityMap alongside the naturalLanguage sentence it corresponds to (same array index, enforced by construction: one traceEntry per pushSentence). */
export class TraceabilityBuilder {
  private readonly entries: TraceabilityMap = [];
  private readonly sentences: string[] = [];

  add(claim: string, refs: EvidenceRef[], sentence: string): void {
    this.entries.push(traceEntry(claim, refs));
    this.sentences.push(sentence);
  }

  build(): { traceability: TraceabilityMap; naturalLanguage: string[] } {
    return { traceability: [...this.entries], naturalLanguage: [...this.sentences] };
  }
}
