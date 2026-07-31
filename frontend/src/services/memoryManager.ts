import { memoryAPI } from './api';

export const memoryManager = {
  loadGameMemory: async (gameType: string) => {
    try {
      const response = await memoryAPI.get(gameType);
      return response.data || {};
    } catch (error) {
      console.error('Failed to load game memory:', error);
      return {};
    }
  },

  saveGameMemory: async (gameType: string, memoryData: Record<string, any>) => {
    try {
      await memoryAPI.save(gameType, memoryData);
      return true;
    } catch (error) {
      console.error('Failed to save game memory:', error);
      return false;
    }
  },

  logMatch: async (gameType: string, won: boolean, durationSeconds: number) => {
    try {
      await memoryAPI.logMatch(gameType, won, durationSeconds);
      return true;
    } catch (error) {
      console.error('Failed to log match:', error);
      return false;
    }
  },

  getStats: async (gameType: string) => {
    try {
      return await memoryAPI.getStats(gameType);
    } catch (error) {
      console.error('Failed to fetch stats:', error);
      return null;
    }
  },
};
