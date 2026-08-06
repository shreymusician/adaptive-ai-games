import { GameState } from '../../vendor-dist/server/src/states/GameState';
import { Models } from '../../vendor-dist/common/src';

export interface RealGameHandle {
  state: GameState;
  messages: Models.MessageJSON[];
}

/** Constructs a REAL, unmodified TOSIOS `GameState` — no mocks, no stubs. Captures every broadcast `MessageJSON` into `messages` (this IS the exact constructor hook TOSIOS itself provides — `GameRoom` normally passes its own `handleMessage`; a test passing its own capture function is exactly as legitimate a use of that hook). */
export function buildRealGame(mode: 'deathmatch' | 'team deathmatch' = 'deathmatch', maxPlayers = 4): RealGameHandle {
  const messages: Models.MessageJSON[] = [];
  const state = new GameState('room-1', 'small', maxPlayers, mode, (message) => messages.push(message));
  return { state, messages };
}

/** Adds `count` players (p1, p2, ...) and ticks once so `Game` notices them (waiting -> lobby), then force-starts the match via `Game`'s own PUBLIC `startGame()` — real code, just skipping the real 10s lobby wait a test shouldn't have to sleep through. */
export function startRealMatch(handle: RealGameHandle, count: number): string[] {
  const ids: string[] = [];
  for (let i = 1; i <= count; i++) {
    const id = `p${i}`;
    handle.state.playerAdd(id, `Player${i}`);
    ids.push(id);
  }
  handle.state.update(); // waiting -> lobby (Game.updateWaiting sees >1 player)
  handle.state.game.startGame(); // real, public API — lobby -> game, without the real 10s wait
  return ids;
}
