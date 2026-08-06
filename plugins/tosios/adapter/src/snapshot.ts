/**
 * captureSnapshot — the ONE place this adapter reads TOSIOS's real,
 * PUBLIC `GameState` fields (`players`/`monsters`/`props`/`bullets`/`game`,
 * every one of them already `public` on the vendored, unmodified classes —
 * see the Phase 10A integration report's "Entity system" section for the
 * full field-by-field audit). Never reads a private field, never calls a
 * private method — everything here is exactly what a Colyseus CLIENT
 * observing this room's state sync would also see, which is what keeps
 * this adapter honest: it can't derive an event from information a human
 * spectator couldn't also have derived from the same public state.
 */
import { TosiosGameState, PlayerSnapshot, PropSnapshot, BulletSnapshot, MonsterSnapshot, TickSnapshot } from './types';

export function captureSnapshot(state: TosiosGameState, ts: number): TickSnapshot {
  const players = new Map<string, PlayerSnapshot>();
  state.players.forEach((player, playerId) => {
    players.set(playerId, {
      playerId,
      name: player.name,
      x: player.x,
      y: player.y,
      lives: player.lives,
      isAlive: player.isAlive,
      kills: player.kills,
      team: player.team,
      lastShootAt: player.lastShootAt,
    });
  });

  const props: PropSnapshot[] = [];
  for (let i = 0; i < state.props.length; i++) {
    const prop = state.props[i];
    props.push({ index: i, type: prop.type, active: prop.active, x: prop.x, y: prop.y });
  }

  const bullets: BulletSnapshot[] = [];
  for (let i = 0; i < state.bullets.length; i++) {
    const bullet = state.bullets[i];
    bullets.push({ index: i, active: bullet.active, x: bullet.x, y: bullet.y, fromX: bullet.fromX, fromY: bullet.fromY, playerId: bullet.playerId, shotAt: bullet.shotAt });
  }

  const monsters: MonsterSnapshot[] = [];
  state.monsters.forEach((monster, monsterId) => {
    monsters.push({ id: monsterId, x: monster.x, y: monster.y, isAlive: monster.isAlive });
  });

  return { ts, players, props, bullets, monsters, gameState: state.game.state };
}
