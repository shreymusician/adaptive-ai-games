# Adaptive AI Games Platform — Project Info

## Overview

A full-stack web platform hosting two browser-based games — **WARDEN** and **THE FIVE** — where the AI opponent adapts to how each player plays over time. Player accounts, match history, and per-game memory are stored server-side so progress (and the AI's "read" on the player) persists across sessions and devices.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, React Router |
| Backend | Express.js, Node.js, TypeScript |
| Database | MongoDB Atlas |
| Auth | JWT (email/password via bcrypt) + Google OAuth (`google-auth-library`) |
| Games | Standalone HTML5 Canvas games, embedded via `<iframe>` |

## Project Structure

```
/
├── frontend/           # React + Vite + TypeScript
│   ├── src/
│   │   ├── pages/       # Landing, Login, Signup, WardenGame, FiveGame
│   │   ├── components/  # GameContainer, ProtectedRoute
│   │   ├── context/      # AuthContext (JWT session state)
│   │   ├── services/     # api.ts (axios), memoryManager.ts
│   │   └── App.tsx       # Routing
│   └── public/games/    # warden.html, the-five.html (standalone game builds)
├── backend/             # Express + Node.js
│   ├── models/           # Player, GameMemory, GameSession (Mongoose schemas)
│   ├── routes/            # auth.ts, memory.ts, health.ts
│   ├── middleware/        # auth.ts (JWT verification)
│   ├── utils/              # jwt.ts (sign/verify)
│   └── db/                  # MongoDB connection
└── mnt/user-data/outputs/ # Source copies of the standalone game HTML files
```

## Core Features

### Authentication
- Email/password signup and login (bcrypt-hashed passwords, JWT session tokens)
- Google Sign-In (verifies Google ID tokens server-side)
- Every player has their own account — all game memory, match history, and stats are scoped to the authenticated user (enforced server-side via JWT, not client-supplied IDs)

### Games
- **WARDEN** — real-time 1v1 dodge/dungeon-boss game. The boss reads the player's roll direction, preferred range, dodge timing, and swing greed, and adapts its attack selection and timing accordingly.
- **THE FIVE** — the player controls a raid boss against an AI-controlled 5-hero squad (tank, mage, telekinetic, healer, assassin) that adapts its target priorities and positioning based on the player's habits (favorite target, favorite ability, aggression).
- Both games persist their own "memory" file (in the browser's `localStorage`, scoped to the game) that grows across playthroughs, independent of the backend account system.
- Both run as self-contained HTML/Canvas files served statically and embedded via `<iframe>`, with a fixed-timestep game loop (consistent speed across 60/120/144Hz displays) and DPR-aware canvas scaling for crisp rendering on high-DPI screens.

### Backend API
- `POST /api/auth/signup`, `/login`, `/google`, `GET /api/auth/me`
- `GET`/`POST /api/memory/:gameType` — save/load per-user, per-game memory
- `POST /api/match` — log a completed match
- `GET /api/stats/:gameType` — win/loss/win-rate stats
- `GET /api/health` — server health check

## Advantages

- **Real persistence, real accounts.** Unlike many "AI learns from you" game demos, progress is tied to an actual authenticated account (not a browser fingerprint or anonymous session), so it follows the player across devices.
- **Server-enforced data isolation.** Memory/match/stat routes derive the player from the JWT rather than trusting a client-supplied ID, so one player can never read or overwrite another's data — a meaningfully more secure design than the URL-param-based approach it replaced.
- **Low-friction game distribution.** Games are self-contained HTML files with no build step or external asset pipeline — easy to iterate on, easy to preview standalone, easy to embed anywhere via iframe.
- **Consistent performance across devices.** The fixed-timestep loop and DPR-aware canvas scaling mean the games play at the same speed and render just as sharply on a 60Hz laptop as on a 144Hz gaming monitor or a retina phone screen.
- **Reasonably lean stack.** No heavyweight game engine, no server-side rendering complexity — just Express + MongoDB + static Canvas games, which keeps hosting costs and operational surface area small.
- **Adaptive AI is genuinely per-player.** Both games' "memory" is a real statistical model of the individual player's tendencies (roll direction bias, preferred range, timing, greed, favorite targets), not a scripted difficulty curve — replayability comes from the AI actually changing its behavior.

## Disadvantages / Known Limitations

- **Two separate memory systems that don't talk to each other.** The games' in-game "AI learns you" adaptation is stored in the iframe's own `localStorage` (per-browser, not synced), while the backend tracks match wins/losses/stats separately. A player who switches devices keeps their account stats but loses the AI's in-game "file" on them — the two systems are not unified.
- **No password reset or email verification flow.** If a user forgets their password or mistypes their email at signup, there's currently no self-service recovery path.
- **Google OAuth requires manual setup.** A Google Cloud OAuth Client ID must be provisioned and added to both frontend and backend `.env` files before Google Sign-In works; until then it's silently hidden rather than erroring loudly.
- **No rate limiting or brute-force protection** on `/api/auth/login` or `/api/auth/signup` — the API currently has no throttling, account lockout, or CAPTCHA, which is a real exposure for a public-facing auth endpoint.
- **JWTs are long-lived (7 days) with no refresh/revocation mechanism.** There's no token blacklist or refresh-token rotation, so a leaked token stays valid until it naturally expires, and there is no way to force-logout a compromised session server-side.
- **Games are unversioned static assets.** Since `warden.html`/`the-five.html` are single monolithic files with inline CSS/JS, there's no code-splitting, no shared component reuse between the two games, and any change requires editing a ~700–900 line file directly rather than composable modules.
- **No automated test coverage.** Both the backend API and the game logic are currently verified only through manual/curl smoke testing — there's no unit or integration test suite guarding against regressions.
- **MongoDB Atlas is a single external dependency with manual IP allowlisting.** Local development requires the developer's current public IP (or `0.0.0.0/0`) to be added to Atlas Network Access by hand; there's no automatic detection or guidance built into the app itself when this misconfiguration causes connection failures.
- **Mobile/touch controls are functional but secondary.** Both games were primarily designed around keyboard/mouse input; touch controls (virtual joystick + buttons) work but haven't been given the same tuning pass as desktop input.

## Current Status

- Backend: authentication, protected memory/match/stats API — implemented and verified end-to-end.
- Frontend: login/signup pages, protected routes, landing page with live stats — implemented.
- Games: both WARDEN and THE FIVE are integrated via iframe, with the standalone-game bugs (broken persistence, frame-rate-dependent speed, blurry high-DPI rendering, a stat-corruption edge case) fixed.
- Not yet built: password reset, rate limiting, automated tests, unified game/account memory.
