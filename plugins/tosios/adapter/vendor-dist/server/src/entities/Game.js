"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Game = void 0;
const common_1 = require("@tosios/common");
const schema_1 = require("@colyseus/schema");
class Game extends schema_1.Schema {
    // Init
    constructor(attributes) {
        super();
        this.state = 'lobby';
        this.roomName = attributes.roomName;
        this.mapName = attributes.mapName;
        this.maxPlayers = attributes.maxPlayers;
        this.mode = attributes.mode;
        this.onWaitingStart = attributes.onWaitingStart;
        this.onLobbyStart = attributes.onLobbyStart;
        this.onGameStart = attributes.onGameStart;
        this.onGameEnd = attributes.onGameEnd;
    }
    // Update
    update(players) {
        switch (this.state) {
            case 'waiting':
                this.updateWaiting(players);
                break;
            case 'lobby':
                this.updateLobby(players);
                break;
            case 'game':
                this.updateGame(players);
                break;
            default:
                break;
        }
    }
    updateWaiting(players) {
        // If there are two players, the game starts.
        if (countPlayers(players) > 1) {
            this.startLobby();
        }
    }
    updateLobby(players) {
        // If a player is alone, the game stops.
        if (countPlayers(players) === 1) {
            this.startWaiting();
            return;
        }
        // If the lobby is over, the game starts.
        if (this.lobbyEndsAt < Date.now()) {
            this.startGame();
        }
    }
    updateGame(players) {
        // If a player is alone, the game stops.
        if (countPlayers(players) === 1) {
            this.onGameEnd();
            this.startWaiting();
            return;
        }
        // If the time is out, the game stops.
        if (this.gameEndsAt < Date.now()) {
            this.onGameEnd({
                type: 'timeout',
                from: 'server',
                ts: Date.now(),
                params: {},
            });
            this.startLobby();
            return;
        }
        // Death Match
        if (this.mode === 'deathmatch' && countActivePlayers(players) === 1) {
            // Check to see if only one player is alive
            const player = getWinningPlayer(players);
            if (player) {
                this.onGameEnd({
                    type: 'won',
                    from: 'server',
                    ts: Date.now(),
                    params: {
                        name: player.name,
                    },
                });
                this.startLobby();
                return;
            }
        }
        // Team Death Match
        if (this.mode === 'team deathmatch') {
            // Check to see if only one team is alive
            const team = getWinningTeam(players);
            if (team) {
                this.onGameEnd({
                    type: 'won',
                    from: 'server',
                    ts: Date.now(),
                    params: {
                        name: team === 'Red' ? 'Red team' : 'Blue team',
                    },
                });
                this.startLobby();
            }
        }
    }
    // Start
    startWaiting() {
        this.lobbyEndsAt = undefined;
        this.gameEndsAt = undefined;
        this.state = 'waiting';
        this.onWaitingStart();
    }
    startLobby() {
        this.lobbyEndsAt = Date.now() + common_1.Constants.LOBBY_DURATION;
        this.gameEndsAt = undefined;
        this.state = 'lobby';
        this.onLobbyStart();
    }
    startGame() {
        this.lobbyEndsAt = undefined;
        this.gameEndsAt = Date.now() + common_1.Constants.GAME_DURATION;
        this.state = 'game';
        this.onGameStart();
    }
}
exports.Game = Game;
__decorate([
    (0, schema_1.type)('string')
], Game.prototype, "state", void 0);
__decorate([
    (0, schema_1.type)('string')
], Game.prototype, "roomName", void 0);
__decorate([
    (0, schema_1.type)('string')
], Game.prototype, "mapName", void 0);
__decorate([
    (0, schema_1.type)('number')
], Game.prototype, "lobbyEndsAt", void 0);
__decorate([
    (0, schema_1.type)('number')
], Game.prototype, "gameEndsAt", void 0);
__decorate([
    (0, schema_1.type)('number')
], Game.prototype, "maxPlayers", void 0);
__decorate([
    (0, schema_1.type)('string')
], Game.prototype, "mode", void 0);
function countPlayers(players) {
    return players.size;
}
function countActivePlayers(players) {
    let count = 0;
    players.forEach((player) => {
        if (player.isAlive) {
            count++;
        }
    });
    return count;
}
function getWinningPlayer(players) {
    let winningPlayer = null;
    players.forEach((player, playerId) => {
        if (player.isAlive) {
            winningPlayer = players.get(playerId);
        }
    });
    return winningPlayer;
}
function getWinningTeam(players) {
    let redAlive = false;
    let blueAlive = false;
    players.forEach((player) => {
        if (player.isAlive) {
            if (player.team === 'Red') {
                redAlive = true;
            }
            else {
                blueAlive = true;
            }
        }
    });
    if (redAlive && blueAlive) {
        return null;
    }
    return redAlive ? 'Red' : 'Blue';
}
