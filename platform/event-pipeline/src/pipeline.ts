import { Db } from 'mongodb';
import express, { Express } from 'express';
import { EventStore } from './event-store';
import { EventProcessor } from './event-processor';
import { EventPipelineConfig, loadConfig } from './config';
import { Logger, rootLogger } from './logger';
import { MetricsRegistry } from './metrics';
import { createEventPipelineRouter } from './router';
import { mintMatchToken, TokenScope } from './auth';

export interface EventPipelineOptions {
  db: Db;
  config?: Partial<EventPipelineConfig>;
  logger?: Logger;
}

/**
 * Composition root: wires EventStore + EventProcessor + config + logger +
 * metrics into one deployable unit and exposes both the Express Router (to
 * mount into an existing app, e.g. platform/api) and a standalone `listen()`
 * for running the pipeline as its own service/tests.
 */
export class EventPipeline {
  readonly config: EventPipelineConfig;
  readonly logger: Logger;
  readonly metrics: MetricsRegistry;
  readonly store: EventStore;
  readonly processor: EventProcessor;
  readonly router: ReturnType<typeof createEventPipelineRouter>;

  constructor(options: EventPipelineOptions) {
    this.config = loadConfig(options.config);
    this.logger = (options.logger ?? rootLogger).child({ component: 'event-pipeline' });
    this.metrics = new MetricsRegistry();
    this.store = new EventStore(options.db);
    this.processor = new EventProcessor(this.store, this.config, this.logger, this.metrics);
    this.router = createEventPipelineRouter({
      store: this.store,
      processor: this.processor,
      config: this.config,
      logger: this.logger,
      metrics: this.metrics,
    });
  }

  /** Must be called once before accepting traffic — creates required indexes. */
  async initialize(): Promise<void> {
    await this.store.ensureIndexes();
    this.logger.info('Event Pipeline initialized', { version: this.config.version });
  }

  /** Convenience for minting a match token — normally called by the match-start flow in platform/api. */
  mintToken(claims: { matchId: string; playerId: string; gameId: string; scope: TokenScope }, ttlSeconds?: number): string {
    return mintMatchToken(claims, this.config, ttlSeconds);
  }

  /** Builds a standalone Express app mounting this pipeline's router under /api. Useful for local dev/tests. */
  buildStandaloneApp(): Express {
    const app = express();
    app.use('/api', this.router);
    return app;
  }
}
