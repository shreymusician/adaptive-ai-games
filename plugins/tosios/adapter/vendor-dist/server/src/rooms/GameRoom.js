"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameRoom = void 0;
const common_1 = require("@tosios/common");
const colyseus_1 = require("colyseus");
const GameState_1 = require("../states/GameState");
class GameRoom extends colyseus_1.Room {
    constructor() {
        super(...arguments);
        //
        // Handlers
        //
        this.handleTick = () => {
            this.state.update();
        };
        this.handleMessage = (message) => {
            this.broadcast(message.type, message);
        };
    }
    //
    // Lifecycle
    //
    onCreate(options) {
        // Set max number of clients for this room
        this.maxClients = common_1.Maths.clamp(options.roomMaxPlayers || 0, common_1.Constants.ROOM_PLAYERS_MIN, common_1.Constants.ROOM_PLAYERS_MAX);
        const playerName = options.playerName.slice(0, common_1.Constants.PLAYER_NAME_MAX);
        const roomName = options.roomName.slice(0, common_1.Constants.ROOM_NAME_MAX);
        // Init Metadata
        this.setMetadata({
            playerName,
            roomName,
            roomMap: options.roomMap,
            roomMaxPlayers: this.maxClients,
            mode: options.mode,
        });
        // Init State
        this.setState(new GameState_1.GameState(roomName, options.roomMap, this.maxClients, options.mode, this.handleMessage));
        this.setSimulationInterval(() => this.handleTick());
        console.log(`${new Date().toISOString()} [Create] player=${playerName} room=${roomName} map=${options.roomMap} max=${this.maxClients} mode=${options.mode}`);
        // Listen to messages from clients
        this.onMessage('*', (client, type, message) => {
            const playerId = client.sessionId;
            // Validate which type of message is accepted
            switch (type) {
                case 'move':
                case 'rotate':
                case 'shoot':
                    this.state.playerPushAction({
                        playerId,
                        ...message,
                    });
                    break;
                default:
                    break;
            }
        });
    }
    onJoin(client, options) {
        this.state.playerAdd(client.sessionId, options.playerName);
        console.log(`${new Date().toISOString()} [Join] id=${client.sessionId} player=${options.playerName}`);
    }
    onLeave(client) {
        this.state.playerRemove(client.sessionId);
        console.log(`${new Date().toISOString()} [Leave] id=${client.sessionId}`);
    }
}
exports.GameRoom = GameRoom;
