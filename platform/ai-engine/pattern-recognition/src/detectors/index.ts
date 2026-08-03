import { PatternRegistry } from '../registry';

import { DodgeDirectionDetector } from './movement/dodge-direction';
import { EscapeRoutesDetector } from './movement/escape-routes';
import { CornerPreferenceDetector } from './movement/corner-preference';
import { CircleStrafingDetector } from './movement/circle-strafing';

import { ReloadTimingDetector } from './combat/reload-timing';
import { TargetPrioritizationDetector } from './combat/target-prioritization';
import { EngagementDistanceDetector } from './combat/engagement-distance';
import { WeaponPreferenceDetector } from './combat/weapon-preference';

import { RetreatConditionsDetector } from './decision/retreat-conditions';
import { HealingTimingDetector } from './decision/healing-timing';
import { AbilityUsageTimingDetector } from './decision/ability-usage-timing';
import { ResourceConservationDetector } from './decision/resource-conservation';

import { RoutePreferenceDetector } from './exploration/route-preference';
import { RoomClearingDetector } from './exploration/room-clearing';
import { ExplorationOrderDetector } from './exploration/exploration-order';

import { PushAfterDamageDetector } from './risk/push-after-damage';
import { ChaseLowHealthDetector } from './risk/chase-low-health';
import { OverextensionDetector } from './risk/overextension';

export {
  DodgeDirectionDetector,
  EscapeRoutesDetector,
  CornerPreferenceDetector,
  CircleStrafingDetector,
  ReloadTimingDetector,
  TargetPrioritizationDetector,
  EngagementDistanceDetector,
  WeaponPreferenceDetector,
  RetreatConditionsDetector,
  HealingTimingDetector,
  AbilityUsageTimingDetector,
  ResourceConservationDetector,
  RoutePreferenceDetector,
  RoomClearingDetector,
  ExplorationOrderDetector,
  PushAfterDamageDetector,
  ChaseLowHealthDetector,
  OverextensionDetector,
};

/**
 * Registers every pattern detector implemented in Phase 6. Adding a new
 * detector means writing one new file under `src/detectors/<category>/`
 * and adding one line here — no existing detector or registry code
 * changes.
 */
export function registerAllDetectors(registry: PatternRegistry): void {
  // Movement
  registry.register(() => new DodgeDirectionDetector());
  registry.register(() => new EscapeRoutesDetector());
  registry.register(() => new CornerPreferenceDetector());
  registry.register(() => new CircleStrafingDetector());
  // Combat
  registry.register(() => new ReloadTimingDetector());
  registry.register(() => new TargetPrioritizationDetector());
  registry.register(() => new EngagementDistanceDetector());
  registry.register(() => new WeaponPreferenceDetector());
  // Decision
  registry.register(() => new RetreatConditionsDetector());
  registry.register(() => new HealingTimingDetector());
  registry.register(() => new AbilityUsageTimingDetector());
  registry.register(() => new ResourceConservationDetector());
  // Exploration
  registry.register(() => new RoutePreferenceDetector());
  registry.register(() => new RoomClearingDetector());
  registry.register(() => new ExplorationOrderDetector());
  // Risk
  registry.register(() => new PushAfterDamageDetector());
  registry.register(() => new ChaseLowHealthDetector());
  registry.register(() => new OverextensionDetector());
}
