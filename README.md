# Adaptive AI Gaming Platform

A platform where AI opponents genuinely learn each player's behavior over time — through observation only, never through hidden stat advantages. The Adaptive AI Engine is the product; games are the medium it runs on.

**Design documents (read in this order):**
1. [`PLATFORM_REDESIGN_PROPOSAL.md`](./PLATFORM_REDESIGN_PROPOSAL.md) — open-source game research and licensing analysis
2. [`PLATFORM_V2_DESIGN.md`](./PLATFORM_V2_DESIGN.md) — platform architecture, Plugin SDK, database/API/deployment/security design
3. [`ADAPTIVE_AI_ENGINE_WHITEPAPER.md`](./ADAPTIVE_AI_ENGINE_WHITEPAPER.md) — the AI Engine's technical design, grounded against Alien: Isolation, Left 4 Dead, the Nemesis System, Forza Drivatar, GOAP, and Utility AI

`archive/` holds WARDEN and THE FIVE — the original proof-of-concept games that proved genuinely adaptive AI opponents are possible in the browser. Frozen, not on the active roadmap. See `archive/README.md`.

## Project Structure

```
/
├── platform/
│   ├── api/                      # Express/Node — auth, plugin registry, dashboard API
│   ├── web/                      # React — Player Dashboard (launcher, profile, match history)
│   ├── sdk/
│   │   ├── client/                # runs inside a plugin's sandboxed iframe
│   │   └── host/                  # runs in the parent frame, enforces the fairness boundary
│   ├── event-pipeline/            # canonical event ingestion, batching, validation, persistence
│   ├── player-intelligence/       # cross-game player profile aggregation
│   └── ai-engine/                 # the Adaptive AI Engine — 10 modules, see below
│       ├── behavior-analysis/
│       ├── memory-engine/
│       ├── player-modeling/
│       ├── pattern-recognition/
│       ├── strategy-planner/
│       ├── decision-engine/
│       ├── difficulty-calibration/
│       ├── opponent-personality/
│       ├── long-term-memory/
│       └── explainability/
├── plugins/                       # one directory per game plugin (empty until Phase 10)
├── archive/                       # WARDEN, THE FIVE — frozen proof-of-concept
└── *.md                           # design documents (see above)
```

Each module under `platform/` is an independent npm workspace with its own `package.json`, `tsconfig.json` (extending the root `tsconfig.base.json`), and `README.md` describing its responsibility and boundary — see the individual READMEs for what each module does and does not own.

## Tech Stack

- **Platform Dashboard**: React 19, TypeScript, Vite, React Router
- **Platform API**: Express.js, Node.js, TypeScript
- **Database**: MongoDB Atlas
- **Auth**: JWT (email/password via bcrypt) + Google OAuth
- **Monorepo tooling**: npm workspaces, shared strict TypeScript config, Vitest

## Local Development Setup

### Prerequisites
- Node.js 18+
- MongoDB Atlas account
- Git

### Install everything (monorepo root)
```bash
npm install
```

### Platform API
```bash
cd platform/api
cp .env.example .env
# fill in MONGODB_URI, JWT_SECRET, GOOGLE_CLIENT_ID, etc.
npm run dev
```
Runs on `http://localhost:5000`.

### Player Dashboard
```bash
cd platform/web
cp .env.example .env
npm run dev
```
Runs on `http://localhost:5173`.

### Test the current state
1. Navigate to `http://localhost:5173` → redirected to `/login` → sign up or use Google Sign-In.
2. The archived WARDEN/THE FIVE games remain playable from the dashboard as of this writing (see `archive/README.md` for status).
3. The Adaptive AI Engine modules under `platform/ai-engine/` are architecture scaffolds as of Phase 1 — no plugin runs against them yet. See each module's `README.md` for its implementation phase.

## API Endpoints (Platform API — `platform/api`)

### Authentication
- `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/google`, `GET /api/auth/me`

### Memory Management
All routes below require `Authorization: Bearer <token>` and operate on the authenticated user's own data.
- `GET`/`POST /api/memory/:gameType`, `POST /api/match`, `GET /api/stats/:gameType`

### Health
- `GET /api/health`

*(The Event Pipeline's own ingestion API — `POST /api/events/batch` — is specified in `PLATFORM_V2_DESIGN.md` §7 and lands in Phase 3.)*

## Environment Variables

### `platform/api/.env`
```
MONGODB_URI=mongodb+srv://...
MONGODB_DB_NAME=adaptive-games
NODE_ENV=development
PORT=5000
CORS_ORIGIN=http://localhost:5173
JWT_SECRET=a-long-random-string
GOOGLE_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com
```

### `platform/web/.env`
```
VITE_API_URL=http://localhost:5000/api
VITE_GOOGLE_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com
```

## Implementation Status

Following the approved phased implementation order (see `ADAPTIVE_AI_ENGINE_WHITEPAPER.md` and the phase-gated roadmap it and `PLATFORM_V2_DESIGN.md` establish):

- [x] Phase 1 — Repository structure (architecture only, no business logic)
- [ ] Phase 2 — Plugin SDK
- [ ] Phase 3 — Event Pipeline
- [ ] Phase 4 — Memory Engine (persistence only)
- [ ] Phase 5 — Player Modeling
- [ ] Phase 6 — Pattern Recognition
- [ ] Phase 7 — Strategy Planner
- [ ] Phase 8 — Decision Engine
- [ ] Phase 9 — Explainability
- [ ] Phase 10 — First real plugin integration (TOSIOS)

Each phase must independently pass testing and remain production-ready before the next begins.

## License

MIT (platform code). Individual game plugins carry their own upstream licenses — see `THIRD_PARTY_NOTICES.md` (added when the first plugin lands in Phase 10) and `PLATFORM_REDESIGN_PROPOSAL.md` §2 for the compliance approach.
