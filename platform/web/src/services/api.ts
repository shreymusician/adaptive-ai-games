import axios from 'axios';
import type { AxiosInstance } from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const TOKEN_KEY = 'auth_token';

const api: AxiosInstance = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const tokenStorage = {
  get: (): string | null => localStorage.getItem(TOKEN_KEY),
  set: (token: string): void => localStorage.setItem(TOKEN_KEY, token),
  clear: (): void => localStorage.removeItem(TOKEN_KEY),
};

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface GameMemoryResponse {
  data: Record<string, any>;
}

export interface StatsResponse {
  gameType: string;
  totalMatches: number;
  wins: number;
  losses: number;
  winRate: string;
}

export const authAPI = {
  signup: (email: string, password: string, name: string): Promise<AuthResponse> =>
    api.post('/auth/signup', { email, password, name }).then((res) => res.data),

  login: (email: string, password: string): Promise<AuthResponse> =>
    api.post('/auth/login', { email, password }).then((res) => res.data),

  loginWithGoogle: (idToken: string): Promise<AuthResponse> =>
    api.post('/auth/google', { idToken }).then((res) => res.data),

  me: (): Promise<{ user: User }> => api.get('/auth/me').then((res) => res.data),
};

export const memoryAPI = {
  get: (gameType: string): Promise<GameMemoryResponse> =>
    api.get(`/memory/${gameType}`).then((res) => res.data),

  save: (gameType: string, data: Record<string, any>) =>
    api.post(`/memory/${gameType}`, { data }).then((res) => res.data),

  logMatch: (gameType: string, won: boolean, duration: number) =>
    api.post('/match', { gameType, won, duration }).then((res) => res.data),

  getStats: (gameType: string): Promise<StatsResponse> =>
    api.get(`/stats/${gameType}`).then((res) => res.data),
};

export interface StartMatchResponse {
  matchId: string;
  playerId: string;
  gameId: string;
  matchToken: string;
}

export const matchAPI = {
  /** POST /api/match/start — mints a short-lived, HMAC-signed match token bound to the authenticated player (see platform/api/routes/match.ts). The frontend never mints or sees the signing secret; it only forwards this token, unmodified, to the game's own server for verification. */
  start: (gameId: string): Promise<StartMatchResponse> =>
    api.post('/match/start', { gameId }).then((res) => res.data),
};

export const healthAPI = {
  check: () => api.get('/health').then((res) => res.data),
};

export default api;
