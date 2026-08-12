export type GameState = 'waiting' | 'lobby' | 'game';
export type GameMode = 'deathmatch' | 'team deathmatch';
export type Teams = 'Red' | 'Blue';
export type WallCollisionType = 'full' | 'none';

/**
 * Represent the initial parameters of a Player
 */
export interface PlayerOptions {
    playerName?: string;
    /** Platform-issued, short-lived, HMAC-signed match token (see POST /api/match/start). Verified server-side before any platform playerId is trusted — never trust this field's contents client-side. */
    matchToken?: string;
}

/**
 * Represent the initial parameters of a Room
 */
export interface RoomOptions {
    playerName?: string;
    roomName: string;
    roomMap: string;
    roomMaxPlayers: number;
    mode: GameMode;
    /** Platform-issued, short-lived, HMAC-signed match token (see POST /api/match/start). Verified server-side before any platform playerId is trusted — never trust this field's contents client-side. */
    matchToken?: string;
}
