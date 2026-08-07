/**
 * LiveMatchRunner — Phase 10B. Drives one real, unmodified TOSIOS `GameState`
 * end-to-end through the full Adaptive AI Engine pipeline:
 *
 *   TOSIOS -> event-deriver -> MatchOrchestrator (Memory Engine -> Player
 *   Modeling -> Pattern Recognition) -> Strategy Planner -> Decision Engine
 *   -> Decision Adapter (getLegalActions/applyDecision) -> TOSIOS
 *
 * with Explainability Engine recording a DecisionExplanation for every real
 * decision made, and a MatchSummary generated once the match ends.
 *
 * No AI logic lives here — this class is pure sequencing/wiring, exactly
 * the same charter `MatchOrchestrator` itself documents. Every judgment
 * call (what action to take, what a player's profile looks like, what
 * pattern is emerging) is made entirely inside Strategy Planner / Decision
 * Engine / Memory Engine / Player Modeling / Pattern Recognition's own
 * code, called here through their real public APIs.
 *
 * ---------------------------------------------------------------------
 * Resolving PHASE_10A_REPORT.md §6 finding #1 (multi-player attribution)
 * ---------------------------------------------------------------------
 * MatchOrchestrator/MemoryEngine's data model assumes ONE matchId maps to
 * ONE playerId (a single `MatchContext` per mounted plugin instance, per
 * the SDK's original per-iframe design). TOSIOS is one Colyseus room
 * hosting MANY players in one match. This runner adopts the resolution the
 * Phase 10A report named as option (a): mint one COMPOSITE matchId per
 * (room, player) — `${roomId}::${playerId}` — so every participant gets
 * their own independent Working/Short-Term Memory session and
 * MatchOrchestrator lifecycle. TosiosCanonicalEvent's real per-player
 * `playerId` (never a single stamped MatchContext.playerId) is preserved
 * on every event; room-level events (MatchStarted/MatchEnded, whose
 * `playerId === ''`) are fanned out to every currently-registered
 * participant's own composite matchId — never dropped, never collapsed
 * onto one arbitrary player. This is a documented architectural decision,
 * not a temporary workaround: it is the smallest change consistent with
 * MatchOrchestrator's existing, tested one-matchId-one-player contract,
 * and requires zero changes to Memory Engine, Player Modeling, Pattern
 * Recognition, or MatchOrchestrator itself.
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
import { Constants, Models } from '../vendor-dist/common/src';
import { getLegalActions, applyDecision } from './decision-adapter';
import { TosiosEventDeriver } from './event-deriver';
import { captureSnapshot } from './snapshot';
import { TosiosCanonicalEvent } from './event-mapping';

const EVENT_SCHEMA_VERSION = '1';

export interface LiveMatchRunnerOptions {
  stack: OrchestrationStack;
  explainability: ExplainabilityEngine;
  gameId: string;
  /** Which of this match's real TOSIOS players (Colyseus sessionIds) are AI-controlled. Every other player is assumed human — this runner never sends actions on their behalf. */
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

export class LiveMatchRunner {
  private readonly deriver = new TosiosEventDeriver();
  private readonly strategyPlanner: StrategyPlanner;
  private readonly decisionEngine: DecisionEngine;
  private readonly matchIdsByPlayer = new Map<string, string>();
  private readonly intentsByPlayer = new Map<string, StrategicIntent>();
  private seq = 0;
  private startedFlag = false;
  private endedFlag = false;

  decisionsMade = 0;
  /** Count of TosiosCanonicalEvent objects derived this match, BEFORE room-level (MatchStarted/MatchEnded) fan-out to every participant. */
  eventsEmitted = 0;
  /** Count of stamped CanonicalEvents actually passed to MatchOrchestrator.ingestEvent — AFTER fan-out, so a single MatchStarted derivation with 2 participants counts as 2 here. This is the real per-player-memory write count. */
  eventsIngested = 0;
  ticksRun = 0;
  /** Cumulative real wall-clock ms spent inside StrategyPlanner.plan() (only counted when actually invoked — a cache hit costs nothing and correctly isn't counted). */
  planningMsTotal = 0;
  planningCalls = 0;
  /** Cumulative real wall-clock ms spent inside DecisionEngine.decide(). */
  decisionMsTotal = 0;

  constructor(
    private readonly state: GameState,
    private readonly roomId: string,
    private readonly opts: LiveMatchRunnerOptions
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

  /** Ingests one tick/message's worth of derived events into every affected player's own match memory. Room-level events (empty playerId — MatchStarted/MatchEnded) fan out to every currently-registered participant, per the finding-#1 resolution above. */
  private ingest(events: TosiosCanonicalEvent[]): void {
    if (events.length === 0) return;
    this.eventsEmitted += events.length;
    for (const e of events) {
      const targets = e.playerId === '' ? Array.from(this.matchIdsByPlayer.keys()) : [e.playerId];
      for (const playerId of targets) {
        const matchId = this.matchIdsByPlayer.get(playerId);
        if (!matchId) continue;
        this.opts.stack.orchestrator.ingestEvent(this.stamp(e, matchId, playerId));
        this.eventsIngested += 1;
      }
    }
  }

  /** Mints one composite matchId per real participant and starts their Memory Engine sessions. Must be called after players have joined but is safe to call idempotently — a no-op once already started. */
  registerParticipants(now: number): void {
    if (this.startedFlag) return;
    this.state.players.forEach((_player, playerId) => {
      this.matchIdsByPlayer.set(playerId, `${this.roomId}::${playerId}`);
    });
    this.startedFlag = true;
    this.deriver.diffTick(captureSnapshot(this.state, now)); // seed the tick-diff baseline
  }

  private buildPublicGameState(playerId: string): { selfHealth?: number; playerHealthVisible?: number; openingAvailable?: boolean } {
    const self = this.state.players.get(playerId);
    if (!self) return {};
    let nearestId: string | null = null;
    let nearestDist = Infinity;
    this.state.players.forEach((other, otherId) => {
      if (otherId === playerId || !other.isAlive) return;
      if (self.team && other.team === self.team) return;
      const d = Math.hypot(other.x - self.x, other.y - self.y);
      if (d < nearestDist) {
        nearestDist = d;
        nearestId = otherId;
      }
    });
    const nearest = nearestId ? this.state.players.get(nearestId) : undefined;
    return {
      selfHealth: self.lives / Constants.PLAYER_MAX_LIVES,
      playerHealthVisible: nearest ? nearest.lives / Constants.PLAYER_MAX_LIVES : undefined,
      openingAvailable: nearest !== undefined && nearestDist < 200,
    };
  }

  /** Real reads only — semantic profile/patterns/episodes as Memory Engine and Pattern Recognition currently have them for this player, via the SAME OrchestrationStack instance MatchOrchestrator commits into. */
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

  private planIfStale(playerId: string, matchId: string, now: number, ctx: PlayerContext): StrategicIntent {
    const cached = this.intentsByPlayer.get(playerId);
    if (cached && now < cached.validUntil) return cached;

    const inputs: PlanningInputs = {
      matchContext: { matchId, playerId, gameId: this.opts.gameId, elapsedMs: now },
      publicGameState: this.buildPublicGameState(playerId),
      semanticProfile: ctx.semanticProfile,
      patterns: ctx.patterns,
      episodicMemory: ctx.episodicMemory,
      awarenessBudget: this.opts.awarenessBudget ?? 0.8,
      personality: this.opts.personality ?? 'aggressive',
    };
    const startedAt = Date.now();
    const intent = this.strategyPlanner.plan(inputs, now);
    this.planningMsTotal += Date.now() - startedAt;
    this.planningCalls += 1;
    this.intentsByPlayer.set(playerId, intent);
    return intent;
  }

  /** One AI player's think-act cycle: plan (if stale) -> decide -> apply through the Decision Adapter -> explain. Never bypasses getLegalActions/applyDecision — the AI can only ever submit an action this tick's getLegalActions actually offered. */
  private async runAIPlayer(playerId: string, matchId: string, now: number): Promise<void> {
    const player = this.state.players.get(playerId);
    if (!player || !player.isAlive) return;

    const legalActions: Action[] = getLegalActions(this.state, playerId, now, Constants.BULLET_RATE);
    if (legalActions.length === 0) return;

    const ctx = await this.loadPlayerContext(playerId);
    const intent = this.planIfStale(playerId, matchId, now, ctx);

    const decisionInputs: DecisionInputs = {
      strategicIntent: intent,
      legalActions,
      matchContext: { matchId, playerId, gameId: this.opts.gameId, elapsedMs: now },
      publicGameState: this.buildPublicGameState(playerId),
      semanticProfile: ctx.semanticProfile,
      patterns: ctx.patterns,
      awarenessBudget: this.opts.awarenessBudget ?? 0.8,
      personality: this.opts.personality ?? 'aggressive',
    };

    const decideStartedAt = Date.now();
    const decision: Decision = this.decisionEngine.decide(decisionInputs, now);
    this.decisionMsTotal += Date.now() - decideStartedAt;
    this.decisionsMade += 1;

    // The ONLY write path: exactly the Action decide() chose, applied through
    // the same playerPushAction route a human client's input takes.
    applyDecision(this.state, playerId, decision.action, now);

    await this.opts.explainability.explainDecision({
      decision,
      strategicIntent: intent,
      semanticProfile: ctx.semanticProfile,
      patterns: ctx.patterns,
      episodes: ctx.rawEpisodes,
    });
  }

  /** One full simulation tick: every AI player decides+acts BEFORE the tick's simulation step (mirroring a human whose input already reached the action queue), then the real TOSIOS simulation advances exactly once, then derived events are diffed and ingested. */
  async tick(now: number): Promise<void> {
    if (this.endedFlag) return;
    if (!this.startedFlag) this.registerParticipants(now);

    for (const [playerId, matchId] of this.matchIdsByPlayer) {
      if (this.isAI(playerId)) await this.runAIPlayer(playerId, matchId, now);
    }

    this.state.update();
    this.ticksRun += 1;
    this.ingest(this.deriver.diffTick(captureSnapshot(this.state, now)));
  }

  /** Feed one broadcast MessageJSON TOSIOS produced (kills, match lifecycle) — mirrors AdaptedGameRoom.handleMessage exactly. Must be wired as (or forwarded from) the `onMessage` callback passed to `GameState`'s constructor. */
  captureMessage(message: Models.MessageJSON): void {
    const byName = new Map<string, string>();
    this.state.players.forEach((p, id) => byName.set(p.name, id));
    this.ingest(this.deriver.captureMessage(message, this.state.game.mapName, this.state.game.mode, this.state.players.size, byName));
    if (message.type === 'stop') this.endedFlag = true;
  }

  /** Call once the match has ended — completes every participant's match independently through MatchOrchestrator (Memory commit -> Player Modeling -> Pattern Recognition), then generates and persists an Explainability match summary for whichever participants actually had at least one recorded decision (human-only participants correctly get no summary — never a fabricated one). */
  async completeAll(now: number): Promise<Map<string, { report: Awaited<ReturnType<OrchestrationStack['orchestrator']['completeMatch']>>; summary: unknown }>> {
    const results = new Map<string, { report: Awaited<ReturnType<OrchestrationStack['orchestrator']['completeMatch']>>; summary: unknown }>();
    for (const [playerId, matchId] of this.matchIdsByPlayer) {
      const report = await this.opts.stack.orchestrator.completeMatch(matchId, now);
      let summary: unknown = null;
      try {
        summary = await this.opts.explainability.summarizeMatch(matchId, now);
      } catch {
        // No DecisionExplanation was ever recorded for this matchId — true for
        // human (non-AI) participants, or an AI player who never had a legal
        // action. Not an error condition; summarizeMatch correctly refuses to
        // fabricate a summary out of zero decisions (see its EmptyDecisionSetError).
      }
      results.set(playerId, { report, summary });
    }
    return results;
  }
}
