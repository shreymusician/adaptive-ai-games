/**
 * AdaptedGameRoom — the ONLY file in this package that touches Colyseus's
 * Room lifecycle. Subclasses the real, unmodified, vendored `GameRoom`
 * (`../upstream/packages/server/src/rooms/GameRoom.ts`) — every override
 * below calls `super.<method>(...)` first (or, for the two arrow-function
 * instance fields `handleTick`/`handleMessage`, replicates their
 * single-line original body exactly — see the inline comments at each call
 * site for why `super.handleTick()` isn't syntactically available) so
 * 100% of TOSIOS's original behavior is preserved, unconditionally, before
 * this adapter observes anything.
 *
 * ZERO bytes of `../upstream/` are modified to make this work — every hook
 * point used here (`onCreate`/`onJoin`/`onLeave`/`this.onMessage`/
 * `this.state`) is a real, PUBLIC extension point Colyseus's own `Room`
 * base class and TOSIOS's own `GameRoom` already expose, not a private
 * internal reached into. See the Phase 10A integration report's "Adapter
 * design" section for the full rationale, including why tick-boundary
 * state diffing (not method patching) is used for damage/pickup events
 * specifically (those happen inside `GameState`'s PRIVATE methods, which
 * genuinely have no public hook to attach to without either modifying
 * upstream or diffing its public output — diffing was chosen).
 */
import { Client } from 'colyseus';
import { GameRoom } from '../vendor-dist/server/src/rooms/GameRoom';
import { GameState } from '../vendor-dist/server/src/states/GameState';
import { Models, Types } from '../vendor-dist/common/src';
import { Constants } from '../vendor-dist/common/src';
import { TosiosEventDeriver } from './event-deriver';
import { TosiosCanonicalEvent } from './event-mapping';
import { captureSnapshot } from './snapshot';
import { PlatformIdentity } from './identity';

export interface MatchTokenClaimsLike {
  matchId: string;
  playerId: string;
  gameId: string;
  scope: string;
}

/**
 * Verifies a platform match token and reports which gameId this room
 * belongs to. Assigned onto the instance before `onCreate`/`onAuth` run —
 * same wiring pattern as `hooks` (see its own doc comment). Left unset,
 * `onAuth` falls back to Colyseus's own default (`return true`) — used only
 * by isolated unit tests that construct `AdaptedGameRoom` directly, never by
 * the live server (`scripts/live-server.js` always wires this).
 */
export interface AdaptedGameRoomAuth {
  verify(token: string): MatchTokenClaimsLike;
  gameId: string;
}

export interface AdaptedGameRoomHooks {
  /** Called with every canonical event this adapter derives, in emission order, already batched per tick/message. Never called synchronously from within a TOSIOS state mutation — always after `state.update()` or `state.playerXxx(...)` has fully returned, so the emitted event always describes a state that has already, actually happened. */
  onEvents(events: TosiosCanonicalEvent[]): void;
  /**
   * Phase 10B — optional. Called once per tick, awaited, immediately BEFORE
   * `state.update()` runs — the only point at which an AI decision can be
   * pushed into TOSIOS's real action queue (`state.playerPushAction`, via
   * the Decision Adapter, exactly as a human client's input would arrive)
   * so it's actually applied by THIS tick's `updatePlayers()`, not the next
   * one. Never called synchronously from within a state mutation itself —
   * always before `state.update()` starts, so it only ever reads state left
   * over from the previous, already-completed tick. Omit for a room that
   * doesn't drive any AI player (default no-op).
   */
  beforeTick?(state: GameState, now: number): void | Promise<void>;
}

/**
 * NOTE on wiring `hooks`: Colyseus instantiates Room subclasses itself
 * (`server.define(name, RoomClass)`), so this class can't take constructor
 * arguments the way a normal class would. `hooks` must be assigned onto the
 * instance before `onCreate` runs — see `scripts/live-server.js` for the
 * pattern used (a `RoomClass` subclass whose own `onCreate` assigns `hooks`
 * before calling `super.onCreate(...)`) — the "RoomClass factory closure"
 * approach this file's own comment previously named as one of two options.
 */
export class AdaptedGameRoom extends GameRoom {
  hooks: AdaptedGameRoomHooks = { onEvents: () => {} };
  /** Assigned before onCreate runs, same wiring pattern as `hooks` — see `AdaptedGameRoomAuth`'s doc comment. */
  auth?: AdaptedGameRoomAuth;

  private readonly deriver = new TosiosEventDeriver();
  private readonly platformIdentityBySession = new Map<string, MatchTokenClaimsLike>();

  // handleTick is an ARROW-FUNCTION INSTANCE FIELD on GameRoom (`handleTick
  // = () => { this.state.update(); }`), not a prototype method — `super.
  // handleTick` is therefore not reachable (there is nothing on
  // GameRoom.prototype to call). Redeclaring it here as an instance field
  // of the same name SHADOWS the parent's during construction (JS class-
  // field init order: parent's own fields run first via the implicit
  // super() call, then this class's own field initializers run and
  // overwrite same-named fields) — so by the time Colyseus's `onCreate`
  // calls `this.setSimulationInterval(() => this.handleTick())`, `this.
  // handleTick` already resolves to THIS version. The body below is an
  // exact, byte-for-byte replication of GameRoom's own one-line original
  // (`this.state.update()`) plus the adapter's own diffing — never a
  // reimplementation of any GAMEPLAY logic, only sequencing.
  //
  // Async since Phase 10B's `beforeTick` hook needs to `await` real (if
  // fast, in-memory) reads before pushing an action. Colyseus's own
  // `setSimulationInterval(() => this.handleTick())` never awaits this
  // return value — it just invokes the function once per tick — so this
  // does not change Colyseus's own tick cadence; it only guarantees that,
  // WITHIN one call, `beforeTick` fully completes before `state.update()`
  // starts, which is the actual ordering guarantee that matters.
  handleTick = async (): Promise<void> => {
    if (this.hooks.beforeTick) {
      try {
        await this.hooks.beforeTick(this.state, Date.now());
      } catch (err) {
        // A failing AI decision must never take down the real, live match
        // for every other (possibly human) player in the room — TOSIOS's
        // own simulation proceeds exactly as if the AI had done nothing
        // this tick, same as a human whose input silently dropped.
        // eslint-disable-next-line no-console
        console.error('[AdaptedGameRoom] beforeTick hook failed — continuing without it this tick', err);
      }
    }
    this.state.update(); // exact original body of GameRoom's own handleTick
    const events = this.deriver.diffTick(captureSnapshot(this.state, Date.now()));
    if (events.length > 0) this.hooks.onEvents(events);
  };

  // handleMessage is likewise an arrow-function instance field
  // (`handleMessage = (message) => { this.broadcast(message.type,
  // message); };`), passed BY REFERENCE into `new GameState(...,
  // this.handleMessage)` inside `onCreate`. Same shadowing mechanism as
  // handleTick: by the time `super.onCreate()` runs and reads `this.
  // handleMessage`, this override has already replaced it — so GameState
  // is constructed with OUR version from the very first message, without
  // touching GameState.ts or GameRoom.ts.
  handleMessage = (message: Models.MessageJSON): void => {
    this.broadcast(message.type, message); // exact original body — every client still gets the same broadcast, unconditionally
    const events = this.deriver.captureMessage(message, this.state.game.mapName, this.state.game.mode, this.maxClients, this.playerIdsByName());
    if (events.length > 0) this.hooks.onEvents(events);
  };

  onCreate(options: Types.RoomOptions): void {
    super.onCreate(options); // registers state (with OUR handleMessage already wired, per above), metadata, and the original wildcard onMessage dispatch

    // Colyseus's `onMessage(type, cb)` OVERWRITES a prior registration for
    // the same type/wildcard rather than adding a second listener — so to
    // observe 'shoot' rate-limiting (see event-deriver.ts's
    // observeShootAttempt doc comment: TOSIOS's own rate-limit check is
    // PRIVATE, inside GameState.playerShoot, with no public hook), this
    // adapter must re-register its own wildcard handler. The dispatch
    // below is an exact replica of GameRoom.onCreate's own switch
    // statement (move/rotate/shoot -> state.playerPushAction) — REPLICATED
    // in our own file, never edited in upstream/, so `git diff` against a
    // pristine upstream/ clone stays empty. If TOSIOS's upstream dispatch
    // logic ever changes, only this file (not upstream/) needs review.
    this.onMessage('*', (client: Client, type: string | number, message: Models.ActionJSON) => {
      const playerId = client.sessionId;

      switch (type) {
        case 'shoot': {
          const player = this.state.players.get(playerId);
          const ts = message.ts ?? Date.now();
          const angle = (message.value as { angle: number } | undefined)?.angle ?? 0;
          if (player) {
            const event = this.deriver.observeShootAttempt(playerId, player.lastShootAt, Constants.BULLET_RATE, angle, ts);
            this.hooks.onEvents([event]);
          }
          this.state.playerPushAction({ ...message, playerId }); // server-derived sessionId always wins over any client-claimed playerId in `message` — same intent as upstream's `{playerId, ...message}`, reordered only so it also satisfies this repo's stricter duplicate-key check
          break;
        }
        case 'move':
        case 'rotate':
          this.state.playerPushAction({ ...message, playerId }); // server-derived sessionId always wins over any client-claimed playerId in `message` — same intent as upstream's `{playerId, ...message}`, reordered only so it also satisfies this repo's stricter duplicate-key check
          break;
        default:
          break;
      }
    });
  }

  /**
   * Colyseus lifecycle hook (unused anywhere else in TOSIOS — confirmed by
   * grep, this is the first time it's implemented). Runs BEFORE `onJoin`,
   * for every connecting client, and can reject the connection outright by
   * throwing. This is the enforcement point for "the server must verify the
   * token before accepting the claimed platform identity" — no platform
   * playerId is ever trusted from `options` directly, only from a
   * successfully-verified token's claims.
   *
   * If `auth` is unset (only true for isolated unit tests that build an
   * `AdaptedGameRoom` without wiring live identity), falls back to
   * Colyseus's own default behavior (`return true`, no verification) so
   * those tests keep working unmodified.
   */
  async onAuth(_client: Client, options: Types.RoomOptions & { matchToken?: string; matchId?: string }): Promise<MatchTokenClaimsLike | true> {
    if (!this.auth) return true;

    const token = options.matchToken;
    if (!token || typeof token !== 'string') {
      throw new Error('matchToken is required to join this room');
    }

    let claims: MatchTokenClaimsLike;
    try {
      claims = this.auth.verify(token);
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : 'Invalid match token');
    }

    if (claims.gameId !== this.auth.gameId) {
      throw new Error(`Token is not valid for game '${this.auth.gameId}'`);
    }
    if (claims.scope !== 'ingest' && claims.scope !== 'admin') {
      throw new Error(`Token scope '${claims.scope}' cannot join a live match`);
    }
    // Defense-in-depth: if the client also declared a matchId (e.g. mirrored
    // from the same POST /api/match/start response that carried the token),
    // it must agree with the token's own — a valid token must never be
    // reinterpreted as authorizing a different match than it was minted for.
    if (options.matchId && options.matchId !== claims.matchId) {
      throw new Error('Token is not authorized for the declared matchId');
    }

    return claims;
  }

  onJoin(client: Client, options: Types.PlayerOptions, auth?: MatchTokenClaimsLike | true): void {
    super.onJoin(client, options);
    if (auth && auth !== true) {
      this.platformIdentityBySession.set(client.sessionId, auth);
    }
    // No canonical equivalent for "player joined" exists in
    // CANONICAL_EVENT_TYPES (@adaptive-ai/sdk-protocol) — see report
    // "Event mappings" for the documented gap. Nothing further to emit
    // here; TOSIOS's own 'joined' MessageJSON is still captured (and
    // correctly produces []) via handleMessage above.
  }

  onLeave(client: Client): void {
    super.onLeave(client);
    this.platformIdentityBySession.delete(client.sessionId);
    // Same as onJoin — 'left' has no canonical equivalent either.
  }

  /**
   * Resolves the durable AI-engine identity for a Colyseus session —
   * verified platform claims if this client presented a valid match token,
   * otherwise the pre-1c fallback (sessionId as playerId, a room-scoped
   * composite matchId). The fallback only ever applies to connections that
   * never went through a verified `onAuth` — in the live server, that's
   * exclusively the server-injected AI opponent (`state.playerAdd`, never a
   * real Colyseus client connection).
   */
  resolvePlatformIdentity(sessionId: string): PlatformIdentity {
    const claims = this.platformIdentityBySession.get(sessionId);
    if (claims) {
      return { playerId: claims.playerId, matchId: claims.matchId, gameId: claims.gameId };
    }
    return { playerId: sessionId, matchId: `${this.roomId}::${sessionId}`, gameId: this.auth?.gameId ?? '' };
  }

  private playerIdsByName(): Map<string, string> {
    const byName = new Map<string, string>();
    this.state.players.forEach((player, playerId) => byName.set(player.name, playerId));
    return byName;
  }
}
