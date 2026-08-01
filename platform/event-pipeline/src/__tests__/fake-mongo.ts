/**
 * A minimal in-memory fake of the exact MongoDB driver surface EventStore
 * and health.ts touch: insertOne/insertMany, findOne, find().sort().skip()
 * .limit().toArray(), countDocuments, estimatedDocumentCount, createIndex,
 * and db.command({ping:1}).
 *
 * Why a fake instead of mongodb-memory-server: this sandbox's network
 * access for downloading a real `mongod` binary is unreliable/slow, which
 * makes a real-binary suite flaky and slow to run repeatedly. This fake is
 * deterministic, has zero external dependencies, and is fast enough to run
 * on every commit — the tradeoff is it doesn't exercise real Mongo query
 * planning/index behavior, which is why `npm run test:mongo-memory` (using
 * mongodb-memory-server, see README) remains available as a supplementary,
 * opt-in suite for environments with reliable network access.
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

export class FakeCollection {
  private docs: Doc[] = [];
  /** Test hook: force every subsequent operation to throw, simulating an outage. */
  public failNext: Error | null = null;
  public failAll: Error | null = null;

  private maybeThrow(): void {
    if (this.failAll) throw this.failAll;
    if (this.failNext) {
      const err = this.failNext;
      this.failNext = null;
      throw err;
    }
  }

  async insertOne(doc: Doc): Promise<{ insertedId: string }> {
    this.maybeThrow();
    this.docs.push({ ...doc });
    return { insertedId: 'fake-id' };
  }

  async insertMany(docs: Doc[]): Promise<{ insertedCount: number }> {
    this.maybeThrow();
    for (const d of docs) this.docs.push({ ...d });
    return { insertedCount: docs.length };
  }

  async findOne(filter: Doc = {}, options: { sort?: Record<string, 1 | -1>; projection?: Doc } = {}): Promise<Doc | null> {
    this.maybeThrow();
    const matched = this.docs.filter((d) => matchesFilter(d, filter));
    const sorted = applySort(matched, options.sort);
    const found = sorted[0] ?? null;
    if (!found) return null;
    return this.project(found, options.projection);
  }

  find(filter: Doc = {}, options: { projection?: Doc } = {}): FakeCursor {
    // maybeThrow deliberately NOT called here — real driver defers execution
    // until toArray(); we approximate by throwing at toArray() time instead.
    const matched = this.docs.filter((d) => matchesFilter(d, filter)).map((d) => this.project(d, options.projection));
    if (this.failAll || this.failNext) {
      const err = this.failAll ?? this.failNext!;
      if (this.failNext) this.failNext = null;
      return {
        sort: () => this.find(filter, options),
        skip: () => this.find(filter, options),
        limit: () => this.find(filter, options),
        toArray: async () => {
          throw err;
        },
      } as unknown as FakeCursor;
    }
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

  async createIndex(): Promise<string> {
    return 'fake-index';
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
}

export class FakeDb {
  private collections = new Map<string, FakeCollection>();
  /** Test hook: make db.command({ping:1}) throw, simulating DB unreachable. */
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
