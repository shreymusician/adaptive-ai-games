import axios from 'axios';
import type { AxiosInstance } from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const api: AxiosInstance = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export interface Player {
  id: string;
  sessionId: string;
  name: string;
}

export interface GameMemoryResponse {
  data: Record<string, any>;
}

export interface StatsResponse {
  playerId: string;
  gameType: string;
  totalMatches: number;
  wins: number;
  losses: number;
  winRate: string;
}

export const playerAPI = {
  create: (sessionId: string, name: string): Promise<Player> =>
    api.post('/player', { sessionId, name }).then((res) => res.data),

  get: (sessionId: string): Promise<Player> =>
    api.get(`/player/${sessionId}`).then((res) => res.data),
};

export const memoryAPI = {
  get: (playerId: string, gameType: string): Promise<GameMemoryResponse> =>
    api.get(`/memory/${playerId}/${gameType}`).then((res) => res.data),

  save: (playerId: string, gameType: string, data: Record<string, any>) =>
    api.post(`/memory/${playerId}/${gameType}`, { data }).then((res) => res.data),

  logMatch: (playerId: string, gameType: string, won: boolean, duration: number) =>
    api.post('/match', { playerId, gameType, won, duration }).then((res) => res.data),

  getStats: (playerId: string, gameType: string): Promise<StatsResponse> =>
    api.get(`/stats/${playerId}/${gameType}`).then((res) => res.data),
};

export const healthAPI = {
  check: () => api.get('/health').then((res) => res.data),
};

export default api;
