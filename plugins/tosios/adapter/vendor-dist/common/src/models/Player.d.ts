import { Teams } from '../types';
import { TreeCollider } from '../collisions';
export interface PlayerJSON {
    x: number;
    y: number;
    radius: number;
    rotation: number;
    playerId: string;
    name: string;
    lives: number;
    maxLives: number;
    team?: Teams;
    color: string;
    kills: number;
    ack?: number;
}
export declare function movePlayer(x: number, y: number, radius: number, dirX: number, dirY: number, speed: number, walls: TreeCollider): {
    x: number;
    y: number;
};
