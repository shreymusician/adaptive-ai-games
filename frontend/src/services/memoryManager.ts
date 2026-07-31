import { memoryAPI, playerAPI } from './api';

const SESSION_ID_KEY = 'game_session_id';
const PLAYER_NAME_KEY = 'player_name';
const PLAYER_ID_KEY = 'player_id';

export const sessionManager = {
  getSessionId: (): string => {
    let sessionId = localStorage.getItem(SESSION_ID_KEY);
    if (!sessionId) {
      sessionId = `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem(SESSION_ID_KEY, sessionId);
    }
    return sessionId;
  },

  getPlayerName: (): string => {
    return localStorage.getItem(PLAYER_NAME_KEY) || 'Anonymous';
  },

  setPlayerName: (name: string): void => {
    localStorage.setItem(PLAYER_NAME_KEY, name);
  },

  getPlayerId: (): string | null => {
    return localStorage.getItem(PLAYER_ID_KEY);
  },

  setPlayerId: (id: string): void => {
    localStorage.setItem(PLAYER_ID_KEY, id);
  },

  clearSession: (): void => {
    localStorage.removeItem(SESSION_ID_KEY);
    localStorage.removeItem(PLAYER_NAME_KEY);
    localStorage.removeItem(PLAYER_ID_KEY);
  },
};

export const memoryManager = {
  initializePlayer: async (playerName: string) => {
    try {
      const sessionId = sessionManager.getSessionId();
      const player = await playerAPI.create(sessionId, playerName);
      sessionManager.setPlayerId(player.id);
      sessionManager.setPlayerName(playerName);
      return player;
    } catch (error) {
      console.error('Failed to initialize player:', error);
      // Fallback: use localStorage
      sessionManager.setPlayerName(playerName);
      return null;
    }
  },

  loadGameMemory: async (gameType: string) => {
    try {
      const playerId = sessionManager.getPlayerId();
      if (!playerId) {
        return {};
      }
      const response = await memoryAPI.get(playerId, gameType);
      return response.data || {};
    } catch (error) {
      console.error('Failed to load game memory:', error);
      return {};
    }
  },

  saveGameMemory: async (gameType: string, memoryData: Record<string, any>) => {
    try {
      const playerId = sessionManager.getPlayerId();
      if (!playerId) {
        console.warn('No player ID, skipping memory save');
        return false;
      }
      await memoryAPI.save(playerId, gameType, memoryData);
      return true;
    } catch (error) {
      console.error('Failed to save game memory:', error);
      return false;
    }
  },

  logMatch: async (gameType: string, won: boolean, durationSeconds: number) => {
    try {
      const playerId = sessionManager.getPlayerId();
      if (!playerId) {
        console.warn('No player ID, skipping match log');
        return false;
      }
      await memoryAPI.logMatch(playerId, gameType, won, durationSeconds);
      return true;
    } catch (error) {
      console.error('Failed to log match:', error);
      return false;
    }
  },

  getStats: async (gameType: string) => {
    try {
      const playerId = sessionManager.getPlayerId();
      if (!playerId) {
        return null;
      }
      return await memoryAPI.getStats(playerId, gameType);
    } catch (error) {
      console.error('Failed to fetch stats:', error);
      return null;
    }
  },
};
