/**
 * LiveRoomAIController — Phase 10B live-networked wiring. Same AI pipeline
 * as `LiveMatchRunner` (Strategy Planner -> Decision Engine -> Decision
 * Adapter -> Explainability, on top of MatchOrchestrator), but shaped to
 * plug into `AdaptedGameRoomHooks` (`beforeTick`/`onEvents`) instead of
 * owning its own tick loop.
 *
 * The distinction matters mechanically, not architecturally: a real,
 * networked `AdaptedGameRoom` already drives its own tick via Colyseus's
 * `setSimulationInterval` (`handleTick` calls `state.update()` itself,
 * once per real tick) — a caller can no longer call `state.update()` a
 * second time the way `LiveMatchRunner.tick()` does when it owns the whole
 * loop in-process. This class instead reacts to the two hooks
 * `AdaptedGameRoom` now exposes: `beforeTick(state, now)` (push AI
 * decisions into the action queue before this tick applies them) and
 * `onEvents(events)` (ingest whatever `AdaptedGameRoom`'s own event
 * deriver already produced this tick/message — no second deriver here).
 *
 * No AI logic lives here, same as `LiveMatchRunner` — every judgment call
 * is made entirely inside Strategy Planner / Decision Engine / Memory
 * Engine / Player Modeling / Pattern Recognition's own real code.
 *
 * Multi-player attribution: same resolution as `LiveMatchRunner` (see its
 * doc comment) — one composite matchId per (room, player).
 */
import { Action, CanonicalEvent } from '@adaptive-ai/sdk-protocol';
import { OrchestrationStack } from '@adaptive-ai/orchestration';
import {
  StrategyPlanner,
  GoalRegistry,
  registerAllGoals,
  loadStrategyPlannerConfig,
  PlanningInputs,
  StrategicIntent,
  PersonalityArchetype,
  SemanticProfileEntry,
  PatternEntry,
  EpisodicMemoryEntry,
} from '@adaptive-ai/strategy-planner';
import { DecisionEngine, DecisionRegistry, registerAllConsiderations, loadDecisionEngineConfig, DecisionInputs, Decision } from '@adaptive-ai/decision-engine';
import { ExplainabilityEngine } from '@adaptive-ai/explainability';

import { GameState } from '../vendor-dist/server/src/states/GameState';
import { Constants } from '../vendor-dist/common/src';
import { getLegalActions, applyDecision } from './decision-adapter';
import { TosiosCanonicalEvent } from './event-mapping';

const EVENT_SCHEMA_VERSION = '1';

export interface LiveRoomAIControllerOptions {
  stack: OrchestrationStack;
  explainability: ExplainabilityEngine;
  gameId: string;
  /** Which of this room's real TOSIOS players (Colyseus sessionIds) are AI-controlled. Every other player is assumed human — this controller never sends actions on their behalf. */
  aiPlayerIds: Set<string>;
  personality?: PersonalityArchetype;
  awarenessBudget?: number;
}

interface PlayerContext {
  semanticProfile: SemanticProfileEntry[];
  patterns: PatternEntry[];
  episodicMemory: EpisodicMemoryEntry[];
  rawEpisodes: Awaited<ReturnType<OrchestrationStack['memoryEngine']['loadPlayerMemory']>>['topEpisodes'];
}

export class LiveRoomAIController {
  private readonly strategyPlanner: StrategyPlanner;
  private readonly decisionEngine: DecisionEngine;
  private readonly matchIdsByPlayer = new Map<string, string>();
  private readonly intentsByPlayer = new Map<string, StrategicIntent>();
  private seq = 0;
  private endedFlag = false;

  decisionsMade = 0;
  eventsIngested = 0;

  constructor(
    private readonly roomId: string,
    private readonly opts: LiveRoomAIControllerOptions
  ) {
    const goalRegistry = new GoalRegistry();
    registerAllGoals(goalRegistry);
    this.strategyPlanner = new StrategyPlanner({ registry: goalRegistry, config: loadStrategyPlannerConfig() });

    const decisionConfig = loadDecisionEngineConfig();
    const decisionRegistry = new DecisionRegistry();
    registerAllConsiderations(decisionRegistry, decisionConfig);
    this.decisionEngine = new DecisionEngine({ registry: decisionRegistry, config: decisionConfig });
  }

  get ended(): boolean {
    return this.endedFlag;
  }

  get participantMatchIds(): ReadonlyMap<string, string> {
    return this.matchIdsByPlayer;
  }

  private isAI(playerId: string): boolean {
    return this.opts.aiPlayerIds.has(playerId);
  }

  private stamp(e: TosiosCanonicalEvent, matchId: string, playerId: string): CanonicalEvent {
    return {
      playerId,
      gameId: this.opts.gameId,
      matchId,
      seq: this.seq++,
      ts: e.ts ?? Date.now(),
      type: e.type,
      payload: e.payload,
      schemaVersion: EVENT_SCHEMA_VERSION,
    };
  }

  /**
   * Refreshes the composite-matchId roster from the room's current real
   * players. Safe to call every tick while the match hasn't started yet
   * (idempotent — re-`set`ting an existing entry is a no-op in effect) so
   * a player who joins mid-lobby is correctly picked up before the real
   * `start` broadcast fires; once TOSIOS's own match state leaves
   * `'waiting'`/`'lobby'`, the caller (see `beforeTick`) stops calling this,
   * freezing the roster for the rest of the match.
   */
  private refreshParticipants(state: GameState): void {
    state.players.forEach((_player, playerId) => {
      if (!this.matchIdsByPlayer.has(playerId)) {
        this.matchIdsByPlayer.set(playerId, `${this.roomId}::${playerId}`);
      }
    });
  }

  /** Ingests one tick/message's worth of already-derived events (from `AdaptedGameRoom`'s own deriver) into every affected player's own match memory. Room-level events (empty playerId — MatchStarted/MatchEnded) fan out to every currently-registered participant. */
  onEvents(events: TosiosCanonicalEvent[]): void {
    if (events.length === 0) return;
    for (const e of events) {
      const targets = e.playerId === '' ? Array.from(this.matchIdsByPlayer.keys()) : [e.playerId];
      for (const playerId of targets) {
        const matchId = this.matchIdsByPlayer.get(playerId);
        if (!matchId) continue;
        this.opts.stack.orchestrator.ingestEvent(this.stamp(e, matchId, playerId));
        this.eventsIngested += 1;
      }
      if (e.type === 'MatchEnded') this.endedFlag = true;
    }
  }

  private buildPublicGameState(state: GameState, playerId: string): { selfHealth?: number; playerHealthVisible?: number; openingAvailable?: boolean } {
    const self = state.players.get(playerId);
    if (!self) return {};
    let nearestId: string | null = null;
    let nearestDist = Infinity;
    state.players.forEach((other, otherId) => {
      if (otherId === playerId || !other.isAlive) return;
      if (self.team && other.team === self.team) return;
      const d = Math.hypot(other.x - self.x, other.y - self.y);
      if (d < nearestDist) {
        nearestDist = d;
        nearestId = otherId;
      }
    });
    const nearest = nearestId ? state.players.get(nearestId) : undefined;
    return {
      selfHealth: self.lives / Constants.PLAYER_MAX_LIVES,
      playerHealthVisible: nearest ? nearest.lives / Constants.PLAYER_MAX_LIVES : undefined,
      openingAvailable: nearest !== undefined && nearestDist < 200,
    };
  }

  private async loadPlayerContext(playerId: string): Promise<PlayerContext> {
    const [memory, patterns] = await Promise.all([
      this.opts.stack.memoryEngine.loadPlayerMemory(playerId, this.opts.gameId, { topEpisodesLimit: 5 }),
      this.opts.stack.patternStore.getForPlayer(playerId, this.opts.gameId),
    ]);
    return {
      semanticProfile: memory.semanticProfile.map((d) => ({ dimension: d.dimension, gameId: d.gameId, value: d.value, confidence: d.confidence, samples: d.samples })),
      patterns: patterns.map((p) => ({ patternId: p.patternId, detectorId: p.detectorId, patternKey: p.patternKey, category: p.category, state: p.state, confidence: p.confidence, description: p.description })),
      episodicMemory: memory.topEpisodes.map((ep) => ({ episodeId: ep.episodeId, episodeType: ep.episodeType, summary: ep.summary, importance: ep.importance, confidence: ep.confidence, timestamp: ep.timestamp })),
      rawEpisodes: memory.topEpisodes,
    };
  }

  private planIfStale(playerId: string, matchId: string, now: number, state: GameState, ctx: PlayerContext): StrategicIntent {
    const cached = this.intentsByPlayer.get(playerId);
    if (cached && now < cached.validUntil) return cached;

    const inputs: PlanningInputs = {
      matchContext: { matchId, playerId, gameId: this.opts.gameId, elapsedMs: now },
      publicGameState: this.buildPublicGameState(state, playerId),
      semanticProfile: ctx.semanticProfile,
      patterns: ctx.patterns,
      episodicMemory: ctx.episodicMemory,
      awarenessBudget: this.opts.awarenessBudget ?? 0.8,
      personality: this.opts.personality ?? 'aggressive',
    };
    const intent = this.strategyPlanner.plan(inputs, now);
    this.intentsByPlayer.set(playerId, intent);
    return intent;
  }

  private async runAIPlayer(state: GameState, playerId: string, matchId: string, now: number): Promise<void> {
    const player = state.players.get(playerId);
    if (!player || !player.isAlive) return;

    const legalActions: Action[] = getLegalActions(state, playerId, now, Constants.BULLET_RATE);
    if (legalActions.length === 0) return;

    const ctx = await this.loadPlayerContext(playerId);
    const intent = this.planIfStale(playerId, matchId, now, state, ctx);

    const decisionInputs: DecisionInputs = {
      strategicIntent: intent,
      legalActions,
      matchContext: { matchId, playerId, gameId: this.opts.gameId, elapsedMs: now },
      publicGameState: this.buildPublicGameState(state, playerId),
      semanticProfile: ctx.semanticProfile,
      patterns: ctx.patterns,
      awarenessBudget: this.opts.awarenessBudget ?? 0.8,
      personality: this.opts.personality ?? 'aggressive',
    };

    const decision: Decision = this.decisionEngine.decide(decisionInputs, now);
    this.decisionsMade += 1;

    // The ONLY write path: exactly the Action decide() chose, applied through
    // the same playerPushAction route a human client's input takes.
    applyDecision(state, playerId, decision.action, now);

    await this.opts.explainability.explainDecision({
      decision,
      strategicIntent: intent,
      semanticProfile: ctx.semanticProfile,
      patterns: ctx.patterns,
      episodes: ctx.rawEpisodes,
    });
  }

  /** Called by `AdaptedGameRoom.handleTick`, awaited, immediately before `state.update()`. Refreshes the participant roster while the match hasn't started, then runs every AI player's think-act cycle. */
  async beforeTick(state: GameState, now: number): Promise<void> {
    if (this.endedFlag) return;
    if (state.game.state !== 'game') this.refreshParticipants(state);

    for (const [playerId, matchId] of this.matchIdsByPlayer) {
      if (this.isAI(playerId)) await this.runAIPlayer(state, playerId, matchId, now);
    }
  }

  /** Call once the match has ended — completes every participant's match independently through MatchOrchestrator, then generates and persists an Explainability match summary for whichever participants actually had at least one recorded decision. */
  async completeAll(now: number): Promise<Map<string, { report: Awaited<ReturnType<OrchestrationStack['orchestrator']['completeMatch']>>; summary: unknown }>> {
    const results = new Map<string, { report: Awaited<ReturnType<OrchestrationStack['orchestrator']['completeMatch']>>; summary: unknown }>();
    for (const [playerId, matchId] of this.matchIdsByPlayer) {
      if (!this.opts.stack.orchestrator.isCompleted(matchId)) {
        const report = await this.opts.stack.orchestrator.completeMatch(matchId, now);
        let summary: unknown = null;
        try {
          summary = await this.opts.explainability.summarizeMatch(matchId, now);
        } catch {
          // No DecisionExplanation was ever recorded for this matchId — true
          // for human (non-AI) participants. Not an error condition.
        }
        results.set(playerId, { report, summary });
      }
    }
    return results;
  }
}
