"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BULLET_RATE = exports.BULLET_SPEED = exports.BULLET_SIZE = exports.FLASK_SIZE = exports.FLASKS_COUNT = exports.MONSTER_ATTACK_BACKOFF = exports.MONSTER_PATROL_DURATION_MAX = exports.MONSTER_PATROL_DURATION_MIN = exports.MONSTER_IDLE_DURATION_MAX = exports.MONSTER_IDLE_DURATION_MIN = exports.MONSTER_LIVES = exports.MONSTER_SIGHT = exports.MONSTER_SPEED_CHASE = exports.MONSTER_SPEED_PATROL = exports.MONSTER_SIZE = exports.MONSTERS_COUNT = exports.PLAYER_HEARING_DISTANCE = exports.PLAYER_WEAPON_SIZE = exports.PLAYER_MAX_LIVES = exports.PLAYER_SPEED = exports.PLAYER_SIZE = exports.TILE_SIZE = exports.BACKGROUND_COLOR = exports.GAME_MODES = exports.GAME_DURATION = exports.LOBBY_DURATION = exports.LOG_LINES_MAX = exports.PLAYER_NAME_MAX = exports.ROOM_NAME_MAX = exports.ROOM_PLAYERS_SCALES = exports.ROOM_PLAYERS_MAX = exports.ROOM_PLAYERS_MIN = exports.MAPS_NAMES = exports.DEBUG = exports.PLAYERS_REFRESH = exports.ROOM_REFRESH = exports.ROOM_NAME = exports.WS_PORT = exports.APP_TITLE = void 0;
exports.APP_TITLE = 'TOSIOS';
// General
exports.WS_PORT = 3001;
exports.ROOM_NAME = 'game'; // Colyseus Room<T>'s name (no need to change)
exports.ROOM_REFRESH = 3000;
exports.PLAYERS_REFRESH = 1000;
exports.DEBUG = false;
// Game
exports.MAPS_NAMES = ['small', 'gigantic'];
exports.ROOM_PLAYERS_MIN = 2;
exports.ROOM_PLAYERS_MAX = 16;
exports.ROOM_PLAYERS_SCALES = [2, 4, 8, 16];
exports.ROOM_NAME_MAX = 16;
exports.PLAYER_NAME_MAX = 16;
exports.LOG_LINES_MAX = 5;
exports.LOBBY_DURATION = 1000 * 10; // 10 seconds
exports.GAME_DURATION = 1000 * 90; // 90 seconds
exports.GAME_MODES = ['deathmatch', 'team deathmatch'];
// Background
exports.BACKGROUND_COLOR = '#25131A';
// Tile (rectangle)
exports.TILE_SIZE = 32;
// Player (circle)
exports.PLAYER_SIZE = 32;
exports.PLAYER_SPEED = 1;
exports.PLAYER_MAX_LIVES = 3;
exports.PLAYER_WEAPON_SIZE = 12; // The bigger, the further away a bullet will be shot from.
exports.PLAYER_HEARING_DISTANCE = 256;
// Monster
exports.MONSTERS_COUNT = 3;
exports.MONSTER_SIZE = 32;
exports.MONSTER_SPEED_PATROL = 0.75;
exports.MONSTER_SPEED_CHASE = 1.25;
exports.MONSTER_SIGHT = 192;
exports.MONSTER_LIVES = 3;
exports.MONSTER_IDLE_DURATION_MIN = 1000;
exports.MONSTER_IDLE_DURATION_MAX = 3000;
exports.MONSTER_PATROL_DURATION_MIN = 1000;
exports.MONSTER_PATROL_DURATION_MAX = 3000;
exports.MONSTER_ATTACK_BACKOFF = 3000;
// Props (rectangle)
exports.FLASKS_COUNT = 3;
exports.FLASK_SIZE = 24;
// Bullet (circle)
exports.BULLET_SIZE = 8;
exports.BULLET_SPEED = 4;
exports.BULLET_RATE = 800; // The bigger, the slower.
