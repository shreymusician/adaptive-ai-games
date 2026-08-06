/**
 * Minimal in-memory fake of the exact MongoDB driver surface
 * ExplanationStore touches: insertOne/replaceOne (upsert), findOne,
 * find().sort().skip().limit().toArray(), countDocuments, createIndex.
 * Same rationale as @adaptive-ai/memory-engine's __tests__/fake-mongo.ts:
 * no reliable network access to a real `mongod` binary in this sandbox.
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
  public indexSpecs: Array<{ spec: Doc; options: Doc }> = [];

  async insertOne(doc: Doc): Promise<{ insertedId: string }> {
    this.docs.push({ ...doc });
    return { insertedId: doc._id ?? `fake-id-${this.docs.length}` };
  }

  async findOne(filter: Doc = {}): Promise<Doc | null> {
    const matched = this.docs.filter((d) => matchesFilter(d, filter));
    return matched[0] ? { ...matched[0] } : null;
  }

  find(filter: Doc = {}): FakeCursor {
    const matched = this.docs.filter((d) => matchesFilter(d, filter));
    return new FakeCursor(matched);
  }

  async countDocuments(filter: Doc = {}): Promise<number> {
    return this.docs.filter((d) => matchesFilter(d, filter)).length;
  }

  async createIndex(spec: Doc, options: Doc = {}): Promise<string> {
    this.indexSpecs.push({ spec, options });
    return 'fake-index';
  }

  async replaceOne(filter: Doc, replacement: Doc, options: { upsert?: boolean } = {}): Promise<{ matchedCount: number; upsertedCount: number }> {
    const idx = this.docs.findIndex((d) => matchesFilter(d, filter));
    if (idx === -1) {
      if (options.upsert) {
        this.docs.push({ ...replacement });
        return { matchedCount: 0, upsertedCount: 1 };
      }
      return { matchedCount: 0, upsertedCount: 0 };
    }
    this.docs[idx] = { ...replacement };
    return { matchedCount: 1, upsertedCount: 0 };
  }

  async deleteMany(filter: Doc = {}): Promise<{ deletedCount: number }> {
    const before = this.docs.length;
    this.docs = this.docs.filter((d) => !matchesFilter(d, filter));
    return { deletedCount: before - this.docs.length };
  }

  size(): number {
    return this.docs.length;
  }

  all(): Doc[] {
    return this.docs.map((d) => ({ ...d }));
  }
}

export class FakeDb {
  private collections = new Map<string, FakeCollection>();

  collection(name: string): FakeCollection {
    let col = this.collections.get(name);
    if (!col) {
      col = new FakeCollection();
      this.collections.set(name, col);
    }
    return col;
  }
}
