/**
 * Real MongoDB connection for the TOSIOS live AI server (Milestone 1b) —
 * replaces scripts/fake-mongo.js for scripts/live-server.js only.
 * run-live-match.js (the synthetic AI-vs-AI CLI demo) is untouched and
 * keeps using FakeDb; it never runs against a real browser match.
 *
 * Reuses platform/api's own environment-variable convention (MONGODB_URI /
 * MONGODB_DB_NAME, see platform/api/db/connection.ts) so both services can
 * point at the same MongoDB database by default — verified safe: every
 * AI-engine collection name (playerProfiles, playerProfileVersions,
 * matchMemories, matchProcessingReports, playerPatterns,
 * playerPatternVersions, playerEpisodes, explanations, gameplayEvents)
 * is distinct from platform/api's Mongoose collections (players,
 * gamememories, gamesessions).
 */
import { MongoClient, Db } from 'mongodb';

const DEFAULT_DB_NAME = 'adaptive-games';

/** Redacts a MongoDB connection string (which embeds credentials) out of any message before it's thrown, logged, or surfaced — this file must never let a URI reach a log line or an error a caller might print. */
function redactMongoUri(message: string): string {
  return message.replace(/mongodb(\+srv)?:\/\/\S+/gi, '[REDACTED_MONGODB_URI]');
}

export interface MongoConfig {
  uri: string;
  dbName: string;
}

/**
 * Pure, synchronous, no network — resolves connection settings from env
 * vars. Throws a clear, actionable error (never a raw `undefined` passed
 * to MongoClient) if MONGODB_URI is missing, per this milestone's
 * "fail clearly with an actionable startup error" requirement.
 */
export function resolveMongoConfig(env: NodeJS.ProcessEnv = process.env): MongoConfig {
  const uri = env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      'MONGODB_URI environment variable is not set. Create plugins/tosios/adapter/.env ' +
        '(see plugins/tosios/adapter/.env.example) with the same MONGODB_URI platform/api ' +
        'uses — both services share one MongoDB database by design.'
    );
  }
  return { uri, dbName: env.MONGODB_DB_NAME || DEFAULT_DB_NAME };
}

export interface RealDbConnection {
  db: Db;
  client: MongoClient;
}

/**
 * Connects to the real, shared MongoDB database. Caller owns the returned
 * client's lifecycle — call `client.close()` on shutdown (see
 * scripts/live-server.js's SIGINT/SIGTERM handlers). Never logs the
 * connection string itself, on either the success or failure path.
 */
export async function connectRealDb(env: NodeJS.ProcessEnv = process.env): Promise<RealDbConnection> {
  const { uri, dbName } = resolveMongoConfig(env);
  const client = new MongoClient(uri);
  try {
    await client.connect();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to connect to MongoDB: ${redactMongoUri(message)}`);
  }
  return { db: client.db(dbName), client };
}
