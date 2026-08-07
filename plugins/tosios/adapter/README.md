# @adaptive-ai/tosios-adapter

The Plugin Adapter + Decision Adapter for TOSIOS (`../upstream/`, vendored unmodified from [halftheopposite/TOSIOS](https://github.com/halftheopposite/TOSIOS), MIT). Translates TOSIOS's real, observable Colyseus server state into canonical platform events, and translates Decision Engine `Action`s back into TOSIOS's own existing input path. **Contains no AI logic** — every function here is a deterministic translation, never a decision.

See `../PHASE_10A_REPORT.md` for the full architecture analysis, event/action mapping tables, and known findings, and `../PHASE_10B_REPORT.md` for live-wiring verification, resolved architectural findings, and real measured results. This file covers only how to build/test/extend this package.

## Status

Phase 10B: `LiveMatchRunner` (`src/live-match-runner.ts`) wires the Decision Adapter into the full AI pipeline — Strategy Planner, Decision Engine, and Explainability, on top of Phase 10A's already-wired Memory Engine / Player Modeling / Pattern Recognition (`@adaptive-ai/orchestration`). Verified end-to-end against a real, unmodified TOSIOS `GameState` (in-process; no live Colyseus server or real MongoDB yet — see `../PHASE_10B_REPORT.md` §5/§8 for exactly what remains).

## Build

```
npm run build
```

This first compiles the vendored subset of TOSIOS this package needs (`npm run build:vendor` — see `tsconfig.vendor.json` and `scripts/build-vendor.js`, and the Phase 10A report's §3.1 for why this step exists), then runs this package's own strict `tsc -b`.

## Test

```
npm test
```

Runs `build:vendor` first, then the real test suite (44 tests) — every test in `event-deriver.test.ts`/`decision-adapter.test.ts`/`action-mapping.test.ts`/`integration.test.ts`/`live-match-runner.test.ts` runs against a genuinely instantiated, unmodified TOSIOS `GameState` (`__tests__/fixtures.ts`), never a mock of TOSIOS's own logic. `live-match-runner.test.ts` additionally exercises the real `OrchestrationStack`/`StrategyPlanner`/`DecisionEngine`/`ExplainabilityEngine` against an in-memory `FakeDb` (`__tests__/fake-mongo.ts` — see its doc comment for why not real MongoDB).

## Run a live match manually (AI-vs-AI, no browser)

```
node scripts/run-live-match.js [matchCount]
```

Runs `matchCount` (default 5) real, sequential AI-vs-AI TOSIOS matches through the full wired pipeline, printing real measured metrics (decisions made, event counts, planning/decision latency, semantic profile and pattern evolution). Plain CommonJS against this package's own `dist/` output — no `ts-node`/`tsx` is installed in this monorepo. Run `npm run build` first.

## Play a real match in a browser (human vs. AI)

```
node scripts/live-server.js
```

Starts a real, networked Colyseus server (default port 3001, matching TOSIOS's own `Constants.WS_PORT`) registering `LiveAdaptedGameRoom` — a thin subclass of `AdaptedGameRoom` that wires its `beforeTick`/`onEvents` hooks to a real `LiveRoomAIController` (Strategy Planner → Decision Engine → Decision Adapter → Explainability, on the same `OrchestrationStack` pattern as `run-live-match.js`) and adds one AI-controlled player (`ai-bot-1`, displayed as "Adaptive AI") to every room the instant it's created. Open `http://localhost:3001` in a browser, enter a name, create/join a room — TOSIOS's real 2-player `waiting → lobby (10s) → game` flow proceeds automatically once you and the AI are both present.

**One-time setup before the first run** — this serves the real, unmodified TOSIOS PixiJS client, which needs to be built once:
```
cd ../upstream
npx yarn install
BUILD_MODE=production npx ts-node ./scripts/build.ts
```
(`BUILD_MODE=production` matters: it's what makes the built client connect back to whatever host/port served the page, rather than hardcoding port 3001 — and it's a one-shot build, not `yarn dev`'s watch mode, which never exits.)

Uses an in-memory `FakeDb` (§ below) — real for this first local playtest, not real MongoDB. See `../PHASE_10B_REPORT.md` (live-server addendum) for the exact verification performed and known limitations (e.g. the AI controller only narrates the first match per room).

## Extension guide

- **New canonical event mapping**: add a pure function to `event-mapping.ts`, then either (a) call it from `event-deriver.ts`'s `captureMessage` if TOSIOS already broadcasts a `MessageJSON` for it, or (b) add a diff check to `diffTick` if it only ever shows up as a public schema field changing.
- **New legal action**: add a builder to `action-mapping.ts` (with real tags from `@adaptive-ai/decision-engine`'s consideration files — never invented), then handle its id in `decision-adapter.ts`'s `applyDecision` and offer it conditionally from `getLegalActions`.
- **Pulling an upstream TOSIOS update**: re-vendor into `../upstream/` (see its `PROVENANCE.md`), update the commit hash there, then re-run `npm run build:vendor` and the test suite — any behavior change TOSIOS itself made will surface as a test failure here, not a silent divergence.
- **Never** edit anything under `../upstream/` — if a fix is needed, it belongs in this package (see the report's §4.1–§4.3 for why every current hook point avoids needing to).
