/**
 * DecisionSelector — picks the winning action from a list of scored
 * candidates. Deterministic by default: highest utility wins, ties broken
 * by `action.id` ascending (never insertion order, which would depend on
 * whatever order the plugin happened to list actions in). Experimental
 * personality's exploration term (whitepaper §9) can override the top pick
 * with a seeded-random lower-ranked candidate — never `Math.random()`, so a
 * replayed decide() call with the same seed reproduces the same pick.
 */

import { explorationEpsilon, seededUnitRandom } from './personality';
import { PersonalityConfig } from './config';
import { ActionScore, AlternativeCandidate, PersonalityArchetype, TieBreakMode } from './types';

export interface SelectionResult {
  selected: ActionScore;
  alternatives: AlternativeCandidate[];
  tieBreak: TieBreakMode;
}

const EPSILON_TOLERANCE = 1e-9;

export function selectBestAction(scores: ActionScore[], personality: PersonalityArchetype, config: PersonalityConfig, seed: string): SelectionResult {
  const ranked = [...scores].sort((a, b) => b.utility - a.utility || a.action.id.localeCompare(b.action.id));

  const topUtility = ranked[0].utility;
  const tiedAtTop = ranked.filter((s) => Math.abs(s.utility - topUtility) < EPSILON_TOLERANCE);
  const genuineTie = tiedAtTop.length > 1;

  let winnerIndex = 0;
  let tieBreak: TieBreakMode = genuineTie ? 'deterministic-id-order' : 'none';

  const epsilon = explorationEpsilon(config, personality);
  if (epsilon > 0 && ranked.length > 1) {
    const roll = seededUnitRandom(`${seed}:explore`);
    if (roll < epsilon) {
      // Deterministically pick a non-top candidate: the seed itself (not a
      // second independent roll) selects WHICH alternative, so the same
      // seed always explores the same way.
      const exploreIndex = 1 + (Math.abs(hashToInt(seed + ':which')) % (ranked.length - 1));
      winnerIndex = exploreIndex;
      tieBreak = 'exploration';
    }
  }

  const selected = ranked[winnerIndex];
  const alternatives: AlternativeCandidate[] = ranked.map((s, i) => ({ actionId: s.action.id, utility: s.utility, rank: i + 1 }));

  return { selected, alternatives, tieBreak };
}

function hashToInt(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}
