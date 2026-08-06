import { MapSchema } from '@colyseus/schema';
import { Circle } from './Circle';
import { Player } from '.';
export declare class Monster extends Circle {
    private rotation;
    private mapWidth;
    private mapHeight;
    private lives;
    private state;
    private lastActionAt;
    private lastAttackAt;
    private idleDuration;
    private patrolDuration;
    private targetPlayerId;
    constructor(x: number, y: number, radius: number, mapWidth: number, mapHeight: number, lives: number);
    update(players: MapSchema<Player>): void;
    updateIdle(players: MapSchema<Player>): void;
    updatePatrol(players: MapSchema<Player>): void;
    updateChase(players: MapSchema<Player>): void;
    startIdle(): void;
    startPatrol(): void;
    startChase(playerId: string): void;
    lookForPlayer(players: MapSchema<Player>): boolean;
    hurt(): void;
    move(speed: number, rotation: number): void;
    attack(): void;
    get isAlive(): boolean;
    get canAttack(): boolean;
}
