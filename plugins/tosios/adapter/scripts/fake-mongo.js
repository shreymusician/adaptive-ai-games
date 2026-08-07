/**
 * Minimal in-memory fake of the exact MongoDB driver surface Memory Engine,
 * Pattern Recognition, ReportStore, and ExplanationStore touch —
 * insertOne/insertMany, findOne, find().sort().skip().limit().toArray(),
 * countDocuments, createIndex, updateOne (with $set/$setOnInsert and
 * upsert), deleteMany.
 *
 * Plain-JS port of @adaptive-ai/orchestration's own
 * src/__tests__/fake-mongo.ts (same rationale: no reliable network access to
 * a real `mongod` binary in this sandbox — see that file's doc comment).
 * Used ONLY by this package's scripts/run-live-match.js driver, which runs
 * as plain compiled/CommonJS Node (no ts-node/tsx available in this repo),
 * never by the library itself or its tests.
 */
'use strict';

function matchesFilter(doc, filter) {
  for (const key of Object.keys(filter)) {
    const condition = filter[key];
    const value = doc[key];
    if (condition !== null && typeof condition === 'object' && !Array.isArray(condition)) {
      for (const op of Object.keys(condition)) {
        const target = condition[op];
        switch (op) {
          case '$gte': if (!(value >= target)) return false; break;
          case '$lte': if (!(value <= target)) return false; break;
          case '$gt': if (!(value > target)) return false; break;
          case '$lt': if (!(value < target)) return false; break;
          case '$in': if (!Array.isArray(target) || !target.includes(value)) return false; break;
          case '$ne': if (value === target) return false; break;
          case '$exists': if (target ? value === undefined : value !== undefined) return false; break;
          default: throw new Error(`FakeMongo: unsupported operator ${op}`);
        }
      }
    } else if (value !== condition) {
      return false;
    }
  }
  return true;
}

function applySort(docs, sort) {
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
  constructor(docs, sortSpec, skipN = 0, limitN) {
    this.docs = docs;
    this.sortSpec = sortSpec;
    this.skipN = skipN;
    this.limitN = limitN;
  }
  sort(spec) { return new FakeCursor(this.docs, spec, this.skipN, this.limitN); }
  skip(n) { return new FakeCursor(this.docs, this.sortSpec, n, this.limitN); }
  limit(n) { return new FakeCursor(this.docs, this.sortSpec, this.skipN, n); }
  async toArray() {
    let result = applySort(this.docs, this.sortSpec);
    result = result.slice(this.skipN);
    if (this.limitN !== undefined) result = result.slice(0, this.limitN);
    return result.map((d) => ({ ...d }));
  }
}

class FakeCollection {
  constructor() {
    this.docs = [];
    this.uniqueKeySets = [];
    this.indexSpecs = [];
  }

  checkUniqueConstraints(doc, excludeIdx = -1) {
    for (const keys of this.uniqueKeySets) {
      const collision = this.docs.some((d, i) => i !== excludeIdx && keys.every((k) => d[k] === doc[k]));
      if (collision) {
        const err = new Error(`FakeMongo: duplicate key error on unique index ${keys.join('_')}`);
        err.code = 11000;
        throw err;
      }
    }
  }

  async insertOne(doc) {
    this.checkUniqueConstraints(doc);
    this.docs.push({ ...doc });
    return { insertedId: doc._id ?? `fake-id-${this.docs.length}` };
  }

  async insertMany(docs) {
    for (const d of docs) this.checkUniqueConstraints(d);
    for (const d of docs) this.docs.push({ ...d });
    return { insertedCount: docs.length };
  }

  async findOne(filter = {}, options = {}) {
    const matched = this.docs.filter((d) => matchesFilter(d, filter));
    const sorted = applySort(matched, options.sort);
    const found = sorted[0] ?? null;
    return found ? this.project(found, options.projection) : null;
  }

  find(filter = {}, options = {}) {
    const matched = this.docs.filter((d) => matchesFilter(d, filter)).map((d) => this.project(d, options.projection));
    return new FakeCursor(matched);
  }

  async countDocuments(filter = {}) {
    return this.docs.filter((d) => matchesFilter(d, filter)).length;
  }

  async estimatedDocumentCount() {
    return this.docs.length;
  }

  async createIndex(spec, options = {}) {
    this.indexSpecs.push({ spec, options });
    if (options.unique) this.uniqueKeySets.push(Object.keys(spec));
    return 'fake-index';
  }

  async updateOne(filter, update, options = {}) {
    const idx = this.docs.findIndex((d) => matchesFilter(d, filter));
    if (idx === -1) {
      if (options.upsert) {
        const seed = {};
        for (const [key, value] of Object.entries(filter)) {
          if (value === null || typeof value !== 'object') seed[key] = value;
        }
        const newDoc = { ...seed, ...(update.$setOnInsert ?? {}), ...(update.$set ?? {}) };
        this.checkUniqueConstraints(newDoc);
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

  async replaceOne(filter, replacement, options = {}) {
    const idx = this.docs.findIndex((d) => matchesFilter(d, filter));
    if (idx === -1) {
      if (options.upsert) {
        this.checkUniqueConstraints(replacement);
        this.docs.push({ ...replacement });
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
      }
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
    }
    this.checkUniqueConstraints(replacement, idx);
    this.docs[idx] = { ...replacement };
    return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
  }

  async deleteMany(filter = {}) {
    const before = this.docs.length;
    this.docs = this.docs.filter((d) => !matchesFilter(d, filter));
    return { deletedCount: before - this.docs.length };
  }

  project(doc, projection) {
    if (!projection) return { ...doc };
    const result = {};
    for (const key of Object.keys(projection)) {
      if (projection[key]) result[key] = doc[key];
    }
    return result;
  }

  size() { return this.docs.length; }
  all() { return this.docs.map((d) => ({ ...d })); }
}

class FakeDb {
  constructor() {
    this.collections = new Map();
  }
  collection(name) {
    let col = this.collections.get(name);
    if (!col) {
      col = new FakeCollection();
      this.collections.set(name, col);
    }
    return col;
  }
  async command(cmd) {
    if (cmd.ping === 1) return { ok: 1 };
    throw new Error(`FakeDb: unsupported command ${JSON.stringify(cmd)}`);
  }
}

module.exports = { FakeDb, FakeCollection };
