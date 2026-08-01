# Phase 3 Implementation Plan — Event Pipeline

## Objective

Build reliable event ingestion infrastructure that validates, deduplicates, orders, and persists gameplay events from plugins.

## Architecture Layers

```
Plugin SDK
  ↓
Event Gateway (HTTP POST /api/events/batch)
  ↓
Authentication (match-scoped tokens)
  ↓
Validation (schema, version, timestamp)
  ↓
Deduplication (match ID + sequence number)
  ↓
Ordering (handle out-of-order packets)
  ↓
Batching (per-match grouping)
  ↓
Persistence (MongoDB, immutable append-only)
  ↓
Replay API (query stored events)
  ↓
Observability (metrics, logging, health checks)
```

## Core Components

### 1. Event Gateway (`@adaptive-ai/event-pipeline`)
- HTTP POST endpoint: `/api/events/batch`
- Match-scoped authentication (JWT tokens with match context)
- Batch size validation (default 1000 events/batch, configurable)
- Payload size limits (default 10MB/batch)
- Compression support (gzip detection)

### 2. Validation Layer
- Schema validation (CanonicalEvent structure)
- Event type validation (against canonical event types)
- Timestamp validation (not in future, reasonable range)
- Sequence number validation (monotonic per match)
- Payload validation (JSON-serializable, size limits)
- Version compatibility checks

### 3. Authentication
- Match-scoped JWT tokens (issued when match starts)
- Token contains: matchId, playerId, gameId
- Rate limiting per match
- Token expiration (match duration + grace period)

### 4. Deduplication
- Track event checksums per match
- Detect and reject duplicates
- Configurable duplicate window (last N events)
- Log duplicate attempts for debugging

### 5. Ordering
- Sequence number validation
- Detect out-of-order events (log warning)
- Detect missing sequences (log gap)
- Handle late-arriving packets (within grace window)
- Deterministic ordering on persist

### 6. Persistence
- MongoDB collection: `gameplayEvents`
- Immutable documents (no updates, only inserts)
- Append-only log structure
- Server-side timestamping (serverTs)
- Event ID generation (unique per match)
- Indexed for replay queries

### 7. Replay API
- `GET /api/events/match/:matchId` — all events for a match
- `GET /api/events/player/:playerId` — all events for a player (paginated)
- `GET /api/events/game/:gameId` — all events for a game (paginated)
- `GET /api/events/replay?matchId=&from=&to=` — time-windowed replay
- Pagination: limit (1-1000), offset

### 8. Observability
- Structured logging (Winston or Pino)
- Metrics (Prometheus client)
  - Event throughput (events/sec)
  - Validation failures
  - Duplicate rate
  - Out-of-order rate
  - Latency (p50, p95, p99)
- Health endpoint: `GET /api/health`
  - Database connectivity
  - Event queue depth
  - Last event processed
  - Pipeline status

## Database Schema

### gameplayEvents
```javascript
{
  _id: ObjectId,
  eventId: string,           // unique per match
  matchId: string,
  playerId: string,
  gameId: string,
  seq: number,               // monotonic per match
  ts: number,                // client timestamp (ms)
  serverTs: number,          // server ingestion time (ms)
  type: string,              // e.g., "PlayerMoved"
  payload: Object,           // event-specific data
  schemaVersion: string,     // "1", etc.
  validationStatus: string,  // "valid", "warning"
  sourcePlugin: string,      // plugin version that emitted it
  createdAt: Date,
  // Indexes:
  // matchId + seq (unique)
  // matchId + ts
  // playerId + ts
  // gameId + ts
  // type
}
```

### eventBatches
```javascript
{
  _id: ObjectId,
  batchId: string,           // unique
  matchId: string,
  playerId: string,
  eventCount: number,
  size: number,              // bytes
  receivedAt: Date,
  processingTime: number,    // ms
  status: string,            // "accepted", "rejected"
  errors: [
    { eventSeq: number, error: string }
  ]
}
```

### matches
```javascript
{
  _id: ObjectId,
  matchId: string,
  playerId: string,
  gameId: string,
  opponentType: string,      // "ai", "human"
  aiPersonality?: string,
  aiDifficultyLevel?: number,
  startedAt: Date,
  endedAt?: Date,
  durationMs?: number,
  outcome?: string,          // "win", "loss", "draw"
  eventCount: number,
  profileSnapshotId?: string,
  createdAt: Date,
  // Indexes:
  // matchId (unique)
  // playerId + startedAt
  // gameId + startedAt
}
```

### pipelineMetrics
```javascript
{
  _id: ObjectId,
  timestamp: Date,
  eventsProcessed: number,
  eventsValid: number,
  eventsDuplicate: number,
  eventsOutOfOrder: number,
  validationErrors: number,
  averageLatencyMs: number,
  p95LatencyMs: number,
  p99LatencyMs: number
}
```

## API Specification

### POST /api/events/batch

**Authentication:** Bearer token (match-scoped JWT)

**Request:**
```json
{
  "matchId": "match-123",
  "events": [
    {
      "type": "PlayerMoved",
      "payload": { "x": 10, "y": 20 },
      "ts": 1625097600000,
      "seq": 1
    },
    ...
  ]
}
```

**Response (202 Accepted):**
```json
{
  "batchId": "batch-abc123",
  "matchId": "match-123",
  "eventCount": 5,
  "accepted": 5,
  "rejected": 0,
  "errors": []
}
```

**Response (400 Bad Request):**
```json
{
  "error": "Validation failed",
  "details": [
    { "index": 1, "error": "Invalid event type" },
    { "index": 3, "error": "Timestamp out of range" }
  ]
}
```

### GET /api/events/match/:matchId

**Query params:**
- `limit`: 1-1000 (default 100)
- `offset`: 0+ (default 0)

**Response:**
```json
{
  "matchId": "match-123",
  "eventCount": 5,
  "events": [
    {
      "eventId": "evt-1",
      "matchId": "match-123",
      "type": "MatchStarted",
      "seq": 1,
      "ts": 1625097600000,
      "serverTs": 1625097600100,
      "payload": {}
    },
    ...
  ],
  "pagination": {
    "limit": 100,
    "offset": 0,
    "total": 5
  }
}
```

### GET /api/events/player/:playerId

Similar structure, paginated, across all matches.

### GET /api/events/game/:gameId

Similar structure, paginated, across all matches.

### GET /api/health

```json
{
  "status": "healthy",
  "database": {
    "connected": true,
    "latencyMs": 5
  },
  "queue": {
    "depth": 42,
    "oldestBatchAge": 1234
  },
  "lastEventProcessed": {
    "matchId": "match-123",
    "eventId": "evt-999",
    "timestamp": "2026-08-01T15:30:00Z"
  }
}
```

## Testing Strategy

### Unit Tests
1. Event validation
   - Valid events pass
   - Invalid schema rejected
   - Invalid types rejected
   - Timestamp validation
   - Sequence validation

2. Deduplication
   - Exact duplicates detected
   - Duplicates within window rejected
   - Duplicates outside window allowed

3. Ordering
   - Out-of-order detection
   - Gap detection
   - Late packet handling

4. Batch processing
   - Valid batches accepted
   - Invalid batches rejected (with detail)
   - Partial failures (some events valid, some not)

### Integration Tests
1. End-to-end event flow
   - Plugin SDK → Event Gateway → Database → Replay API
   
2. Concurrent batches
   - Multiple plugins sending concurrently
   - No race conditions
   - Ordering preserved

3. Database operations
   - Events persisted correctly
   - Indexes work
   - Queries fast enough

4. Authentication
   - Valid tokens accepted
   - Expired tokens rejected
   - Invalid tokens rejected
   - Rate limiting works

### Performance Tests
1. Throughput
   - Events per second (target: 1000+)
   
2. Latency
   - Event acceptance latency (p50, p95, p99)
   
3. Replay performance
   - Large match queries
   - Time-window queries
   - Player history queries

### Stress Tests
1. Large batches (10K+ events)
2. High concurrency (100+ concurrent matches)
3. Data volume (millions of events)

## Deliverables

1. Event Pipeline package (`@adaptive-ai/event-pipeline`)
2. REST API (POST /api/events/batch + GET endpoints)
3. Database schema (MongoDB collections)
4. Authentication & rate limiting
5. Comprehensive tests (unit, integration, performance)
6. Documentation (API spec, schema, error codes)
7. Observability (metrics, logging, health checks)
8. Example client code (using plugin SDK)

## Success Criteria

- ✅ All endpoints implemented and tested
- ✅ Validation catches all invalid data
- ✅ Events persisted reliably
- ✅ Replay API returns correct data
- ✅ No data loss
- ✅ Handles out-of-order packets
- ✅ Handles duplicates
- ✅ Performance: 1000+ events/sec
- ✅ Comprehensive documentation
- ✅ Production-ready error handling
