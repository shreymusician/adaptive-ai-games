const { Client } = require('colyseus.js');

const MATCH_TOKEN = process.argv[2];
const PLAYER_NAME = process.argv[3] || 'E2EPlayer1e';
const STAY_MS = Number(process.argv[4] || 25000);

async function main() {
  const client = new Client('ws://localhost:3001');
  const room = await client.joinOrCreate('game', {
    playerName: PLAYER_NAME,
    roomName: 'e2e-room-1e-' + Date.now(),
    roomMap: 'small',
    roomMaxPlayers: 2,
    mode: 'deathmatch',
    matchToken: MATCH_TOKEN,
  });
  console.log('JOINED sessionId=' + room.sessionId + ' roomId=' + room.id);
  room.onMessage('*', (type) => console.log('MSG', type));

  await new Promise((r) => setTimeout(r, STAY_MS));
  room.leave();
  await new Promise((r) => setTimeout(r, 1000));
  process.exit(0);
}

main().catch((err) => {
  console.error('JOIN_FAILED', err && err.message ? err.message : err);
  process.exit(1);
});
