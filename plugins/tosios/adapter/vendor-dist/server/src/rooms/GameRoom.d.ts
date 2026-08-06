import { Models, Types } from '@tosios/common';
import { Client, Room } from 'colyseus';
import { GameState } from '../states/GameState';
export declare class GameRoom extends Room<GameState> {
    onCreate(options: Types.RoomOptions): void;
    onJoin(client: Client, options: Types.PlayerOptions): void;
    onLeave(client: Client): void;
    handleTick: () => void;
    handleMessage: (message: Models.MessageJSON) => void;
}
