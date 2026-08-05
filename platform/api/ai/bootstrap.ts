/**
 * Wires the Adaptive AI Engine's orchestration stack (Event Pipeline ->
 * Memory Engine -> Player Modeling -> Pattern Recognition, see
 * @adaptive-ai/orchestration) into platform/api.
 *
 * Reuses the existing Mongoose connection's underlying native `mongodb.Db`
 * handle (mongoose.connection.db) rather than opening a second database
 * connection — every AI-engine package depends on the native `mongodb`
 * driver's `Db` type, not Mongoose, by design (see @adaptive-ai/memory-engine's
 * README "Architecture" — plain Db dependency injection, no ODM).
 */

import mongoose from 'mongoose';
import { OrchestrationStack } from '@adaptive-ai/orchestration';

let stack: OrchestrationStack | null = null;

/** Must be called once, after connectDB() has resolved (so mongoose.connection.db exists), and awaited before mounting any AI routes. */
export async function initAIStack(): Promise<OrchestrationStack> {
  if (stack) return stack;

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('initAIStack: mongoose.connection.db is not available — call connectDB() first');
  }

  // mongoose 9.x bundles its own `mongodb` driver major version, published
  // separately from the standalone `mongodb` package every AI-engine
  // package depends on — two structurally-similar but nominally distinct
  // `Db` types from TypeScript's perspective, even though both wrap the
  // same wire-compatible MongoDB driver surface (collection(), command(),
  // etc. — the only methods every AI-engine store actually calls). Cast
  // through `unknown` rather than forcing a single dependency version
  // across the monorepo, which would risk destabilizing mongoose's own
  // internals for a cosmetic type-identity mismatch.
  stack = new OrchestrationStack({ db: db as unknown as ConstructorParameters<typeof OrchestrationStack>[0]['db'] });
  await stack.initialize();
  return stack;
}

/** Throws if initAIStack() has not run yet — every route module that needs the stack calls this instead of importing the module-level variable directly, so a route registered before initialization fails loudly instead of silently holding a stale null. */
export function getAIStack(): OrchestrationStack {
  if (!stack) {
    throw new Error('getAIStack: AI stack not initialized — initAIStack() must be awaited before routes are mounted');
  }
  return stack;
}
