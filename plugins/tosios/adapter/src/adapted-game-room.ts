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
import { Models, Types } from '../vendor-dist/common/src';
import { Constants } from '../vendor-dist/common/src';
import { TosiosEventDeriver } from './event-deriver';
import { TosiosCanonicalEvent } from './event-mapping';
import { captureSnapshot } from './snapshot';

export interface AdaptedGameRoomHooks {
  /** Called with every canonical event this adapter derives, in emission order, already batched per tick/message. Never called synchronously from within a TOSIOS state mutation — always after `state.update()` or `state.playerXxx(...)` has fully returned, so the emitted event always describes a state that has already, actually happened. */
  onEvents(events: TosiosCanonicalEvent[]): void;
}

/**
 * NOTE on wiring `hooks`: Colyseus instantiates Room subclasses itself
 * (`server.define(name, RoomClass)`), so this class can't take constructor
 * arguments the way a normal class would. `hooks` must be assigned onto the
 * instance before `onCreate` runs — see this package's README "Wiring
 * AdaptedGameRoom into a live server" for the two supported ways to do
 * that (a `RoomClass` factory closure, or Colyseus's own `room.listing`
 * metadata pattern), deferred to Phase 10B along with the rest of live
 * wiring (out of scope for Phase 10A per the mission brief).
 */
export class AdaptedGameRoom extends GameRoom {
  hooks: AdaptedGameRoomHooks = { onEvents: () => {} };

  private readonly deriver = new TosiosEventDeriver();

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
  handleTick = (): void => {
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

  onJoin(client: Client, options: Types.PlayerOptions): void {
    super.onJoin(client, options);
    // No canonical equivalent for "player joined" exists in
    // CANONICAL_EVENT_TYPES (@adaptive-ai/sdk-protocol) — see report
    // "Event mappings" for the documented gap. Nothing further to emit
    // here; TOSIOS's own 'joined' MessageJSON is still captured (and
    // correctly produces []) via handleMessage above.
  }

  onLeave(client: Client): void {
    super.onLeave(client);
    // Same as onJoin — 'left' has no canonical equivalent either.
  }

  private playerIdsByName(): Map<string, string> {
    const byName = new Map<string, string>();
    this.state.players.forEach((player, playerId) => byName.set(player.name, playerId));
    return byName;
  }
}
