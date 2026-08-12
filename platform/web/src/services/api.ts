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

// --- Adaptive AI Engine dashboard (read-only) ---
// Mirrors the real response shapes from
// platform/ai-engine/orchestration/src/dashboard-router.ts exactly — no
// invented fields. Every call is scoped to the authenticated player's own
// id (never a URL/query/localStorage-supplied id); the backend's
// requireOwnPlayerId/filterMatchReportByOwner middleware (Milestone 1a)
// remains the actual security boundary — this client can't weaken it.

/** The whitepaper's `ProfileDimension` — Player Modeling's per-trait output (@adaptive-ai/memory-engine's SemanticDimensionState). */
export interface SemanticDimensionState {
  playerId: string;
  gameId: string | null;
  dimension: string;
  value: number;
  confidence: number;
  samples: number;
  version: number;
  updatedAt: number;
}

/** @adaptive-ai/memory-engine's PlayerEpisode. */
export interface PlayerEpisode {
  episodeId: string;
  playerId: string;
  gameId: string;
  matchId: string;
  timestamp: number;
  episodeType: string;
  summary: string;
  importance: number;
  confidence: number;
}

/** GET /dashboard/players/:playerId/profile — @adaptive-ai/memory-engine's PlayerMemorySnapshot. */
export interface PlayerProfileResponse {
  playerId: string;
  gameId: string | null;
  semanticProfile: SemanticDimensionState[];
  topEpisodes: PlayerEpisode[];
  loadedAt: number;
}

/** @adaptive-ai/pattern-recognition's PatternRecord. */
export interface PatternRecord {
  playerId: string;
  gameId: string;
  patternId: string;
  category: 'movement' | 'combat' | 'decision' | 'exploration' | 'risk';
  description: string;
  state: 'candidate' | 'confirmed' | 'strong' | 'weakening' | 'retired';
  observationCount: number;
  confidence: number;
  lastObservedAt: number;
}

/** GET /dashboard/players/:playerId/patterns */
export interface PatternsResponse {
  playerId: string;
  gameId: string;
  patternCount: number;
  total: number;
  patterns: PatternRecord[];
}

/** @adaptive-ai/orchestration's MatchProcessingReport (subset actually used here). */
export interface MatchProcessingReport {
  reportId: string;
  matchId: string;
  playerId: string;
  gameId: string;
  status: 'complete' | 'partial' | 'failed';
  startedAt: number;
  completedAt: number;
  durationMs: number;
  eventCount: number;
}

/** GET /dashboard/players/:playerId/reports — sorted most-recent-first by the backend. */
export interface ReportsResponse {
  playerId: string;
  reportCount: number;
  reports: MatchProcessingReport[];
}

export const dashboardAPI = {
  getProfile: (playerId: string, gameId: string): Promise<PlayerProfileResponse> =>
    api.get(`/dashboard/players/${playerId}/profile`, { params: { gameId } }).then((res) => res.data),

  getPatterns: (playerId: string, gameId: string): Promise<PatternsResponse> =>
    api.get(`/dashboard/players/${playerId}/patterns`, { params: { gameId, limit: 8, sortBy: 'confidence' } }).then((res) => res.data),

  getReports: (playerId: string, limit = 5): Promise<ReportsResponse> =>
    api.get(`/dashboard/players/${playerId}/reports`, { params: { limit } }).then((res) => res.data),
};

export const healthAPI = {
  check: () => api.get('/health').then((res) => res.data),
};

export default api;
