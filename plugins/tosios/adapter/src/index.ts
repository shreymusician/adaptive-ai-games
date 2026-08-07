export { TOSIOS_MANIFEST } from './manifest';

export { TosiosEventDeriver, attributeDamage } from './event-deriver';
export type { DamagedPlayerAttribution } from './event-deriver';

export {
  matchStartedEvent,
  matchEndedEvent,
  playerMovedEvent,
  playerDamagedEvent,
  playerDiedEvent,
  abilityUsedShootEvent,
  abilityOnCooldownAttemptEvent,
  itemPickedEvent,
} from './event-mapping';
export type { TosiosCanonicalEvent, MatchEndOutcome, DamageSourceType } from './event-mapping';

export { captureSnapshot } from './snapshot';
export type { PlayerSnapshot, PropSnapshot, BulletSnapshot, MonsterSnapshot, TickSnapshot } from './types';

export { COMPASS_VECTORS, normalize, angleTo, buildMoveAction, buildHoldAction, buildAdvanceOnOpponentAction, buildRetreatFromOpponentAction, buildShootAction } from './action-mapping';
export type { CompassDirection } from './action-mapping';

export { getLegalActions, applyDecision } from './decision-adapter';
export type { AppliedAction } from './decision-adapter';

export { AdaptedGameRoom } from './adapted-game-room';
export type { AdaptedGameRoomHooks } from './adapted-game-room';

export { LiveMatchRunner } from './live-match-runner';
export type { LiveMatchRunnerOptions } from './live-match-runner';

export { LiveRoomAIController } from './live-room-controller';
export type { LiveRoomAIControllerOptions } from './live-room-controller';
