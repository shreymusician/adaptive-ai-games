/**
 * Minimal in-memory fake of the exact MongoDB driver surface Memory Engine's
 * stores touch: insertOne/insertMany, findOne, find().sort().skip().limit()
 * .toArray(), countDocuments, createIndex, updateOne (with $set/$setOnInsert
 * and upsert), deleteMany.
 *
 * Same rationale as @adaptive-ai/event-pipeline's fake-mongo.ts: no reliable
 * network access to a real `mongod` binary in this sandbox. This fake adds
 * `updateOne` with a filtered match count on top of the event-pipeline
 * version, which is what lets SemanticMemoryStore implement optimistic
 * concurrency (compare-and-swap on a version field) and get a real
 * "did someone else win the race" signal back, exactly like a real
 * conditional `updateOne` would report via `matchedCount`.
 */

type Doc = Record<string, any>;

function matchesFilter(doc: Doc, filter: Doc): boolean {
  for (const key of Object.keys(filter)) {
    const condition = filter[key];
    const value = doc[key];
    if (condition !== null && typeof condition === 'object' && !Array.isArray(condition)) {
      for (const op of Object.keys(condition)) {
        const target = condition[op];
        switch (op) {
          case '$gte':
            if (!(value >= target)) return false;
            break;
          case '$lte':
            if (!(value <= target)) return false;
            break;
          case '$gt':
            if (!(value > target)) return false;
            break;
          case '$lt':
            if (!(value < target)) return false;
            break;
          case '$in':
            if (!Array.isArray(target) || !target.includes(value)) return false;
            break;
          case '$exists':
            if (target ? value === undefined : value !== undefined) return false;
            break;
          default:
            throw new Error(`FakeMongo: unsupported operator ${op}`);
        }
      }
    } else if (value !== condition) {
      return false;
    }
  }
  return true;
}

function applySort(docs: Doc[], sort?: Record<string, 1 | -1>): Doc[] {
  if (!sort) return docs;
  const entries = Object.entries(sort);
  return [...docs].sort((a, b) => {
    for (const [key, dir] of entries) {
      if (a[key] < b[key]) return -1 * dir;
      if (a[key] > b[key]) return 1 * dir;
    }
    return 0;
  });
}

class FakeCursor {
  constructor(
    private docs: Doc[],
    private sortSpec?: Record<string, 1 | -1>,
    private skipN: number = 0,
    private limitN?: number
  ) {}

  sort(spec: Record<string, 1 | -1>): FakeCursor {
    return new FakeCursor(this.docs, spec, this.skipN, this.limitN);
  }
  skip(n: number): FakeCursor {
    return new FakeCursor(this.docs, this.sortSpec, n, this.limitN);
  }
  limit(n: number): FakeCursor {
    return new FakeCursor(this.docs, this.sortSpec, this.skipN, n);
  }
  async toArray(): Promise<Doc[]> {
    let result = applySort(this.docs, this.sortSpec);
    result = result.slice(this.skipN);
    if (this.limitN !== undefined) result = result.slice(0, this.limitN);
    return result.map((d) => ({ ...d }));
  }
}

/** Mimics MongoDB's E11000 duplicate-key error shape closely enough for callers' `err.code === 11000` checks. */
export class FakeDuplicateKeyError extends Error {
  readonly code = 11000;
  constructor(keyDescription: string) {
    super(`FakeMongo: duplicate key error on unique index ${keyDescription}`);
    this.name = 'FakeDuplicateKeyError';
  }
}

export class FakeCollection {
  private docs: Doc[] = [];
  public failNext: Error | null = null;
  private uniqueKeySets: string[][] = [];

  private maybeThrow(): void {
    if (this.failNext) {
      const err = this.failNext;
      this.failNext = null;
      throw err;
    }
  }

  /** Throws FakeDuplicateKeyError if `doc` collides with an existing doc (other than at `excludeIdx`) on any declared unique-index key set. */
  private checkUniqueConstraints(doc: Doc, excludeIdx: number = -1): void {
    for (const keys of this.uniqueKeySets) {
      const collision = this.docs.some((d, i) => i !== excludeIdx && keys.every((k) => d[k] === doc[k]));
      if (collision) throw new FakeDuplicateKeyError(keys.join('_'));
    }
  }

  async insertOne(doc: Doc): Promise<{ insertedId: string }> {
    this.maybeThrow();
    this.checkUniqueConstraints(doc);
    this.docs.push({ ...doc });
    return { insertedId: doc._id ?? `fake-id-${this.docs.length}` };
  }

  async insertMany(docs: Doc[]): Promise<{ insertedCount: number }> {
    this.maybeThrow();
    for (const d of docs) this.checkUniqueConstraints(d);
    for (const d of docs) this.docs.push({ ...d });
    return { insertedCount: docs.length };
  }

  async findOne(filter: Doc = {}, options: { sort?: Record<string, 1 | -1>; projection?: Doc } = {}): Promise<Doc | null> {
    this.maybeThrow();
    const matched = this.docs.filter((d) => matchesFilter(d, filter));
    const sorted = applySort(matched, options.sort);
    const found = sorted[0] ?? null;
    return found ? this.project(found, options.projection) : null;
  }

  find(filter: Doc = {}, options: { projection?: Doc } = {}): FakeCursor {
    const matched = this.docs.filter((d) => matchesFilter(d, filter)).map((d) => this.project(d, options.projection));
    return new FakeCursor(matched);
  }

  async countDocuments(filter: Doc = {}): Promise<number> {
    this.maybeThrow();
    return this.docs.filter((d) => matchesFilter(d, filter)).length;
  }

  async estimatedDocumentCount(): Promise<number> {
    this.maybeThrow();
    return this.docs.length;
  }

  async createIndex(spec: Doc, options: Doc = {}): Promise<string> {
    this.indexSpecs.push({ spec, options });
    if (options.unique) this.uniqueKeySets.push(Object.keys(spec));
    return 'fake-index';
  }

  /** Test/inspection helper: what indexes have been declared (for migration-safety tests). */
  public indexSpecs: Array<{ spec: Doc; options: Doc }> = [];

  /**
   * Real MongoDB semantics subset: applies `$set`/`$setOnInsert` to the
   * first matching doc. Returns matchedCount/modifiedCount so callers can
   * detect a lost compare-and-swap race (matchedCount === 0 means the
   * filter — typically including an expected `version` — no longer holds).
   */
  async updateOne(filter: Doc, update: { $set?: Doc; $setOnInsert?: Doc }, options: { upsert?: boolean } = {}): Promise<{ matchedCount: number; modifiedCount: number; upsertedCount: number }> {
    this.maybeThrow();
    const idx = this.docs.findIndex((d) => matchesFilter(d, filter));
    if (idx === -1) {
      if (options.upsert) {
        const newDoc: Doc = { ...filterToSeedDoc(filter), ...(update.$setOnInsert ?? {}), ...(update.$set ?? {}) };
        this.checkUniqueConstraints(newDoc); // real Mongo: a racing upsert on the same unique key throws E11000, not a silent second doc
        this.docs.push(newDoc);
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
      }
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
    }
    const merged = { ...this.docs[idx], ...(update.$set ?? {}) };
    this.checkUniqueConstraints(merged, idx);
    this.docs[idx] = merged;
    return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
  }

  async deleteMany(filter: Doc = {}): Promise<{ deletedCount: number }> {
    this.maybeThrow();
    const before = this.docs.length;
    this.docs = this.docs.filter((d) => !matchesFilter(d, filter));
    return { deletedCount: before - this.docs.length };
  }

  private project(doc: Doc, projection?: Doc): Doc {
    if (!projection) return { ...doc };
    const result: Doc = {};
    for (const key of Object.keys(projection)) {
      if (projection[key]) result[key] = doc[key];
    }
    return result;
  }

  /** Test helper: raw doc count regardless of filter. */
  size(): number {
    return this.docs.length;
  }

  /** Test helper: raw snapshot of all docs, for assertions that need to inspect storage directly. */
  all(): Doc[] {
    return this.docs.map((d) => ({ ...d }));
  }
}

/** Seeds an upserted doc with the filter's own equality clauses (e.g. {playerId, gameId, dimension}), skipping operator clauses. */
function filterToSeedDoc(filter: Doc): Doc {
  const seed: Doc = {};
  for (const [key, value] of Object.entries(filter)) {
    if (value === null || typeof value !== 'object') {
      seed[key] = value;
    }
  }
  return seed;
}

export class FakeDb {
  private collections = new Map<string, FakeCollection>();
  public pingFailure: Error | null = null;

  collection(name: string): FakeCollection {
    let col = this.collections.get(name);
    if (!col) {
      col = new FakeCollection();
      this.collections.set(name, col);
    }
    return col;
  }

  async command(cmd: Doc): Promise<Doc> {
    if (cmd.ping === 1) {
      if (this.pingFailure) throw this.pingFailure;
      return { ok: 1 };
    }
    throw new Error(`FakeDb: unsupported command ${JSON.stringify(cmd)}`);
  }
}
