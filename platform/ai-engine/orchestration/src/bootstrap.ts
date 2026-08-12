/**
 * OrchestrationStack — composition root. Mirrors the same pattern
 * @adaptive-ai/event-pipeline's `EventPipeline` class already establishes:
 * wire every dependency from one `Db`, expose the pieces a host app
 * (platform/api) needs to mount, and require one `initialize()` call before
 * accepting traffic.
 *
 * This is the ONLY place in the platform that constructs all four
 * coordinated modules together. Nothing here contains AI logic — every
 * analyzer/detector registration call below simply delegates to each
 * module's own `registerAllAnalyzers()` / `registerAllDetectors()`.
 */

import { Db } from 'mongodb';
import { MemoryEngine } from '@adaptive-ai/memory-engine';
import { DimensionRegistry, PlayerModelingEngine, loadPlayerModelingConfig, registerAllAnalyzers } from '@adaptive-ai/player-modeling';
import { PatternRegistry, PatternStore, PatternRecognitionEngine, loadPatternRecognitionConfig, registerAllDetectors } from '@adaptive-ai/pattern-recognition';
import {
  EventStore,
  EventProcessor,
  EventPipelineConfig,
  loadConfig as loadEventPipelineConfig,
  createEventPipelineRouter,
  MetricsRegistry,
  mintMatchToken,
  verifyMatchToken,
  MatchTokenClaims,
  TokenScope,
  rootLogger as eventPipelineRootLogger,
} from '@adaptive-ai/event-pipeline';
import { MatchOrchestrator } from './match-orchestrator';
import { OrchestratingEventProcessor } from './orchestrating-processor';
import { ReportStore } from './report-store';
import { createDashboardRouter } from './dashboard-router';
import { Logger, rootLogger } from './logger';
import { loadOrchestrationConfig, OrchestrationConfig, MatchCompletedEvent } from './types';

export interface OrchestrationStackOptions {
  db: Db;
  eventPipelineConfig?: Partial<EventPipelineConfig>;
  orchestrationConfig?: Partial<OrchestrationConfig>;
  logger?: Logger;
}

export class OrchestrationStack {
  readonly config: OrchestrationConfig;
  readonly logger: Logger;

  readonly memoryEngine: MemoryEngine;
  readonly playerModelingEngine: PlayerModelingEngine;
  readonly patternStore: PatternStore;
  readonly patternRecognitionEngine: PatternRecognitionEngine;

  readonly eventStore: EventStore;
  readonly eventPipelineConfig: EventPipelineConfig;
  readonly metrics: MetricsRegistry;

  readonly orchestrator: MatchOrchestrator;
  readonly reportStore: ReportStore;

  /** Drop-in replacement for a plain EventProcessor — feed this into createEventPipelineRouter's `processor` dependency to get automatic orchestration on every batch that contains a MatchEnded event. */
  readonly orchestratingProcessor: OrchestratingEventProcessor;

  /** The full Event Pipeline router (validation/auth/rate-limit/storage/replay), wired to `orchestratingProcessor` instead of a plain EventProcessor — mount this under /api in the host app. */
  readonly eventRouter: ReturnType<typeof createEventPipelineRouter>;

  /** Read-only dashboard API (player profile, dimensions, patterns, episodes, processing reports) — mount this under /api in the host app. */
  readonly dashboardRouter: ReturnType<typeof createDashboardRouter>;

  constructor(options: OrchestrationStackOptions) {
    this.config = loadOrchestrationConfig(options.orchestrationConfig);
    this.logger = (options.logger ?? rootLogger).child({ component: 'orchestration-stack' });

    // --- Memory Engine (Phase 4) ---
    // Each coordinated module owns its own dependency-free Logger class (by
    // deliberate convention — see each package's logger.ts doc comment), so
    // this package's Logger is never passed across a module boundary; every
    // module is left to default to its own rootLogger instead.
    this.memoryEngine = new MemoryEngine({ db: options.db });

    // --- Player Modeling (Phase 5) ---
    const dimensionRegistry = new DimensionRegistry();
    registerAllAnalyzers(dimensionRegistry);
    const playerModelingConfig = loadPlayerModelingConfig();
    this.playerModelingEngine = new PlayerModelingEngine({
      memoryEngine: this.memoryEngine,
      registry: dimensionRegistry,
      config: playerModelingConfig,
    });

    // --- Pattern Recognition (Phase 6) ---
    const patternRegistry = new PatternRegistry();
    registerAllDetectors(patternRegistry);
    this.patternStore = new PatternStore(options.db);
    const patternRecognitionConfig = loadPatternRecognitionConfig();
    this.patternRecognitionEngine = new PatternRecognitionEngine({
      memoryEngine: this.memoryEngine,
      patternStore: this.patternStore,
      registry: patternRegistry,
      config: patternRecognitionConfig,
    });

    // --- Event Pipeline (Phase 3) ---
    this.eventPipelineConfig = loadEventPipelineConfig(options.eventPipelineConfig);
    this.metrics = new MetricsRegistry();
    this.eventStore = new EventStore(options.db);
    const innerProcessor = new EventProcessor(this.eventStore, this.eventPipelineConfig, undefined, this.metrics);

    // --- Orchestration (Phase 6.5 — this package) ---
    this.orchestrator = new MatchOrchestrator({
      memoryEngine: this.memoryEngine,
      playerModelingEngine: this.playerModelingEngine,
      patternRecognitionEngine: this.patternRecognitionEngine,
      logger: this.logger,
    });
    this.reportStore = new ReportStore(options.db);

    // Publish + persist: every completed match's report is durably saved
    // the moment MatchOrchestrator emits it, regardless of which caller
    // (HTTP batch ingest, a future non-HTTP event source, a test) drove
    // completion. This is the "publish completion event" requirement,
    // implemented as a plain EventEmitter listener rather than a message
    // broker — appropriate for a single-process deployment; see README
    // "Known limitations" for the multi-instance gap.
    this.orchestrator.on('match:completed', ({ report }: MatchCompletedEvent) => {
      this.reportStore.save(report).catch((err) => {
        this.logger.error('Failed to persist match processing report', {
          matchId: report.matchId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    });

    this.orchestratingProcessor = new OrchestratingEventProcessor(innerProcessor, this.orchestrator, this.logger);

    this.eventRouter = createEventPipelineRouter({
      store: this.eventStore,
      processor: this.orchestratingProcessor,
      config: this.eventPipelineConfig,
      logger: eventPipelineRootLogger,
      metrics: this.metrics,
    });

    this.dashboardRouter = createDashboardRouter({
      memoryEngine: this.memoryEngine,
      patternStore: this.patternStore,
      reportStore: this.reportStore,
      logger: this.logger,
    });
  }

  /** Must be called once before accepting traffic — creates every collection's indexes across all four modules. */
  async initialize(): Promise<void> {
    await Promise.all([this.memoryEngine.initialize(), this.patternRecognitionEngine.initialize(), this.eventStore.ensureIndexes(), this.reportStore.ensureIndexes()]);
    this.logger.info('Orchestration stack initialized');
  }

  /** Convenience for minting a match-scoped ingestion token — normally called by platform/api's match-start flow, right after MemoryEngine.startMatch(). */
  mintMatchToken(claims: { matchId: string; playerId: string; gameId: string; scope: TokenScope }, ttlSeconds?: number): string {
    return mintMatchToken(claims, this.eventPipelineConfig, ttlSeconds);
  }

  /** Convenience for verifying a match-scoped token — normally called by a plugin's live game server (e.g. TOSIOS's `AdaptedGameRoom.onAuth`) before trusting any client-declared identity. Throws on any invalid/expired/tampered token. */
  verifyMatchToken(token: string): MatchTokenClaims {
    return verifyMatchToken(token, this.eventPipelineConfig);
  }
}
