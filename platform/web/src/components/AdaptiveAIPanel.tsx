import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  dashboardAPI,
  type PlayerProfileResponse,
  type PatternsResponse,
  type ReportsResponse,
} from '../services/api';
import '../styles/AdaptiveAIPanel.css';

const TOSIOS_GAME_ID = 'tosios';

type PanelState = 'loading' | 'unauthorized' | 'error' | 'empty' | 'ready';

function formatDimensionLabel(dimension: string): string {
  return dimension
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export const AdaptiveAIPanel = () => {
  const { user } = useAuth();
  const [state, setState] = useState<PanelState>('loading');
  const [profile, setProfile] = useState<PlayerProfileResponse | null>(null);
  const [patterns, setPatterns] = useState<PatternsResponse | null>(null);
  const [reports, setReports] = useState<ReportsResponse | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    // Every call is scoped to the authenticated user's own id (from
    // AuthContext, itself derived server-side from the JWT) — never a URL
    // or query param. The backend's requireOwnPlayerId/filterMatchReportByOwner
    // guards (Milestone 1a) are the real enforcement boundary regardless.
    Promise.all([
      dashboardAPI.getReports(user.id, 5),
      dashboardAPI.getProfile(user.id, TOSIOS_GAME_ID),
      dashboardAPI.getPatterns(user.id, TOSIOS_GAME_ID),
    ])
      .then(([reportsRes, profileRes, patternsRes]) => {
        if (cancelled) return;
        setReports(reportsRes);
        setProfile(profileRes);
        setPatterns(patternsRes);
        setState(reportsRes.reportCount === 0 ? 'empty' : 'ready');
      })
      .catch((err) => {
        if (cancelled) return;
        const status = err?.response?.status;
        setState(status === 401 || status === 403 ? 'unauthorized' : 'error');
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user || state === 'loading') {
    return (
      <div className="ai-panel">
        <h2>Adaptive AI Intelligence</h2>
        <div className="ai-panel-status">Loading Adaptive AI data...</div>
      </div>
    );
  }

  if (state === 'unauthorized') {
    return (
      <div className="ai-panel">
        <h2>Adaptive AI Intelligence</h2>
        <div className="ai-panel-status ai-panel-error">
          Your session may have expired. Please log in again to view your Adaptive AI data.
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="ai-panel">
        <h2>Adaptive AI Intelligence</h2>
        <div className="ai-panel-status ai-panel-error">Could not load Adaptive AI data right now.</div>
      </div>
    );
  }

  if (state === 'empty') {
    return (
      <div className="ai-panel">
        <h2>Adaptive AI Intelligence</h2>
        <div className="ai-panel-status">
          <p>No matches processed yet. Play the Adaptive AI game and the platform will start learning from your play.</p>
          <Link to="/play/tosios" className="ai-panel-cta">Play Now</Link>
        </div>
      </div>
    );
  }

  const latestReport = reports?.reports[0] ?? null;
  const dimensions = profile?.semanticProfile ?? [];
  const episodes = profile?.topEpisodes ?? [];
  const patternList = patterns?.patterns ?? [];

  return (
    <div className="ai-panel">
      <h2>Adaptive AI Intelligence</h2>
      <p className="ai-panel-subtitle">
        Real data from the Adaptive AI Engine — Memory, Player Modeling, and Pattern Recognition — about your Adaptive AI matches.
      </p>

      <div className="ai-panel-grid">
        <div className="ai-panel-card">
          <h4>Matches Processed</h4>
          <div className="ai-panel-big-stat">{reports?.reportCount ?? 0}</div>
          {latestReport && (
            <div className="ai-panel-latest-match">
              <span className={`ai-status-badge ai-status-${latestReport.status}`}>{latestReport.status}</span>
              <span className="ai-panel-latest-match-date">{formatDate(latestReport.completedAt)}</span>
            </div>
          )}
        </div>

        <div className="ai-panel-card">
          <h4>Learned Player Traits</h4>
          {dimensions.length === 0 ? (
            <p className="ai-panel-empty-note">No traits learned yet — more matches will refine these.</p>
          ) : (
            <ul className="ai-dimension-list">
              {dimensions.map((d) => (
                <li key={d.dimension}>
                  <div className="ai-dimension-row">
                    <span className="ai-dimension-label">{formatDimensionLabel(d.dimension)}</span>
                    <span className="ai-dimension-value">{Math.round(d.value * 100)}%</span>
                  </div>
                  <div className="ai-dimension-bar">
                    <div className="ai-dimension-bar-fill" style={{ width: `${Math.round(d.value * 100)}%` }} />
                  </div>
                  <span className="ai-dimension-confidence">Confidence: {Math.round(d.confidence * 100)}% ({d.samples} samples)</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="ai-panel-card">
          <h4>Detected Patterns</h4>
          {patternList.length === 0 ? (
            <p className="ai-panel-empty-note">No confirmed patterns yet.</p>
          ) : (
            <ul className="ai-pattern-list">
              {patternList.map((p) => (
                <li key={p.patternId}>
                  <div className="ai-pattern-row">
                    <span className="ai-pattern-description">{p.description}</span>
                    <span className={`ai-status-badge ai-status-${p.state}`}>{p.state}</span>
                  </div>
                  <span className="ai-pattern-meta">{p.category} · {Math.round(p.confidence * 100)}% confidence · seen {p.observationCount}x</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="ai-panel-card">
          <h4>Recent AI Observations</h4>
          {episodes.length === 0 ? (
            <p className="ai-panel-empty-note">No notable moments recorded yet.</p>
          ) : (
            <ul className="ai-episode-list">
              {episodes.map((e) => (
                <li key={e.episodeId}>
                  <span className="ai-episode-summary">{e.summary}</span>
                  <span className="ai-episode-meta">{formatDate(e.timestamp)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};
