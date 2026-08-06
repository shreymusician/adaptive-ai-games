import { Models, Types } from '@tosios/common';
import { MapSchema, Schema } from '@colyseus/schema';
import { Player } from './Player';
export interface IGame {
    roomName: string;
    mapName: string;
    maxPlayers: number;
    mode: Types.GameMode;
    onWaitingStart: (message?: Models.MessageJSON) => void;
    onLobbyStart: (message?: Models.MessageJSON) => void;
    onGameStart: (message?: Models.MessageJSON) => void;
    onGameEnd: (message?: Models.MessageJSON) => void;
}
export declare class Game extends Schema {
    state: Types.GameState;
    roomName: string;
    mapName: string;
    lobbyEndsAt: number;
    gameEndsAt: number;
    maxPlayers: number;
    mode: Types.GameMode;
    private onWaitingStart;
    private onLobbyStart;
    private onGameStart;
    private onGameEnd;
    constructor(attributes: IGame);
    update(players: MapSchema<Player>): void;
    updateWaiting(players: MapSchema<Player>): void;
    updateLobby(players: MapSchema<Player>): void;
    updateGame(players: MapSchema<Player>): void;
    startWaiting(): void;
    startLobby(): void;
    startGame(): void;
}
