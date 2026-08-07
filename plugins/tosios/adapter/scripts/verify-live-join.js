/**
 * One-off verification script (not part of the shipped product): scripts a
 * real colyseus.js WebSocket client joining the running live-server, to
 * confirm end-to-end room creation + AI bot addition + real match start
 * BEFORE asking a human to open a browser. Deletable — kept only if useful
 * for future debugging.
 */
'use strict';
const { Client } = require('../../upstream/node_modules/colyseus.js');

async function main() {
  const client = new Client('ws://localhost:3001');
  console.log('[verify] connecting...');
  const room = await client.joinOrCreate('game', {
    playerName: 'HumanTester',
    roomName: 'verify-room',
    roomMap: 'small',
    roomMaxPlayers: 4,
    mode: 'deathmatch',
  });
  console.log('[verify] joined room', room.id, 'sessionId', room.sessionId);

  room.onStateChange((state) => {
    const playerIds = [];
    state.players.forEach((_p, id) => playerIds.push(id));
    console.log(`[verify] state update: game.state=${state.game.state} players=${JSON.stringify(playerIds)}`);
  });

  room.onMessage('*', (type, message) => {
    console.log('[verify] message:', type, JSON.stringify(message));
  });

  await new Promise((resolve) => setTimeout(resolve, 15000));
  console.log('[verify] done observing, leaving.');
  room.leave();
  process.exit(0);
}

main().catch((err) => {
  console.error('[verify] failed:', err);
  process.exit(1);
});
