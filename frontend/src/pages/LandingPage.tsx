import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { sessionManager, memoryManager } from '../services/memoryManager';
import { memoryAPI } from '../services/api';
import '../styles/LandingPage.css';

interface Stats {
  totalMatches: number;
  wins: number;
  losses: number;
  winRate: string;
}

export const LandingPage = () => {
  const [playerName, setPlayerName] = useState('');
  const [inputName, setInputName] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [wardenStats, setWardenStats] = useState<Stats | null>(null);
  const [fiveStats, setFiveStats] = useState<Stats | null>(null);

  useEffect(() => {
    const name = sessionManager.getPlayerName();
    if (name && name !== 'Anonymous') {
      setPlayerName(name);
      setInitialized(true);
      loadStats();
    }
  }, []);

  const loadStats = async () => {
    try {
      const playerId = sessionManager.getPlayerId();
      if (playerId) {
        const warden = await memoryAPI.getStats(playerId, 'warden');
        const five = await memoryAPI.getStats(playerId, 'five');
        setWardenStats(warden);
        setFiveStats(five);
      }
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  };

  const handleInitialize = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputName.trim()) return;

    await memoryManager.initializePlayer(inputName);
    setPlayerName(inputName);
    setInitialized(true);
    loadStats();
  };

  const handleChangeName = () => {
    setInitialized(false);
    setInputName('');
    setWardenStats(null);
    setFiveStats(null);
  };

  return (
    <div className="landing-container">
      <header className="landing-header">
        <h1>Adaptive AI Games</h1>
        <p className="tagline">Challenge AI opponents that learn from your play</p>
      </header>

      {!initialized ? (
        <div className="player-setup">
          <form onSubmit={handleInitialize}>
            <input
              type="text"
              placeholder="Enter your name"
              value={inputName}
              onChange={(e) => setInputName(e.target.value)}
              autoFocus
              required
            />
            <button type="submit">Start Playing</button>
          </form>
        </div>
      ) : (
        <>
          <div className="player-greeting">
            <div className="greeting-content">
              <p>Welcome, <strong>{playerName}</strong>!</p>
              <button className="change-name-btn" onClick={handleChangeName}>Change Name</button>
            </div>
          </div>

          <div className="games-grid">
            <Link to="/play/warden" className="game-card">
              <div className="game-card-header">
                <h3>WARDEN</h3>
                <div className="game-badge">1v1</div>
              </div>
              <p className="game-description">
                Real-time action dodging. Master the boss's attack patterns and survive the onslaught.
              </p>
              {wardenStats && (
                <div className="game-stats">
                  <div className="stat">
                    <span className="stat-label">Matches</span>
                    <span className="stat-value">{wardenStats.totalMatches}</span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Win Rate</span>
                    <span className="stat-value">{wardenStats.winRate}%</span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Wins</span>
                    <span className="stat-value">{wardenStats.wins}</span>
                  </div>
                </div>
              )}
              <span className="play-button">Play Now</span>
            </Link>

            <Link to="/play/five" className="game-card">
              <div className="game-card-header">
                <h3>THE FIVE</h3>
                <div className="game-badge">5v1</div>
              </div>
              <p className="game-description">
                Lead a squad of 5 warriors against an adaptive boss. Coordinate tactics as the enemy learns.
              </p>
              {fiveStats && (
                <div className="game-stats">
                  <div className="stat">
                    <span className="stat-label">Matches</span>
                    <span className="stat-value">{fiveStats.totalMatches}</span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Win Rate</span>
                    <span className="stat-value">{fiveStats.winRate}%</span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Wins</span>
                    <span className="stat-value">{fiveStats.wins}</span>
                  </div>
                </div>
              )}
              <span className="play-button">Play Now</span>
            </Link>
          </div>

          {(wardenStats || fiveStats) && (
            <div className="record-section">
              <h2>Your Record</h2>
              <div className="record-grid">
                {wardenStats && (
                  <div className="record-card">
                    <h4>WARDEN</h4>
                    <div className="record-stats">
                      <div className="record-stat">
                        <span>{wardenStats.totalMatches}</span>
                        <span className="label">Total Matches</span>
                      </div>
                      <div className="record-stat">
                        <span>{wardenStats.wins}</span>
                        <span className="label">Victories</span>
                      </div>
                      <div className="record-stat">
                        <span>{wardenStats.losses}</span>
                        <span className="label">Defeats</span>
                      </div>
                    </div>
                    <div className="win-rate-bar">
                      <div className="bar-fill" style={{ width: `${parseFloat(wardenStats.winRate)}%` }}></div>
                    </div>
                    <p className="win-rate-text">{wardenStats.winRate}% Win Rate</p>
                  </div>
                )}
                {fiveStats && (
                  <div className="record-card">
                    <h4>THE FIVE</h4>
                    <div className="record-stats">
                      <div className="record-stat">
                        <span>{fiveStats.totalMatches}</span>
                        <span className="label">Total Matches</span>
                      </div>
                      <div className="record-stat">
                        <span>{fiveStats.wins}</span>
                        <span className="label">Victories</span>
                      </div>
                      <div className="record-stat">
                        <span>{fiveStats.losses}</span>
                        <span className="label">Defeats</span>
                      </div>
                    </div>
                    <div className="win-rate-bar">
                      <div className="bar-fill" style={{ width: `${parseFloat(fiveStats.winRate)}%` }}></div>
                    </div>
                    <p className="win-rate-text">{fiveStats.winRate}% Win Rate</p>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="info-section">
            <h2>How It Works</h2>
            <div className="info-grid">
              <div className="info-card">
                <div className="info-icon">🤖</div>
                <h4>Adaptive Learning</h4>
                <p>Every action you take teaches the AI something new. The boss evolves with your strategies.</p>
              </div>
              <div className="info-card">
                <div className="info-icon">💾</div>
                <h4>Persistent Memory</h4>
                <p>Your match history and the boss's learned patterns are saved forever. Return anytime and continue the challenge.</p>
              </div>
              <div className="info-card">
                <div className="info-icon">📈</div>
                <h4>Increasing Challenge</h4>
                <p>As you improve and master tactics, the AI adapts and counters your moves. True mastery is earned.</p>
              </div>
            </div>
          </div>

          <div className="gameplay-section">
            <h2>Game Modes</h2>
            <div className="gameplay-grid">
              <div className="gameplay-card">
                <h4>🎮 WARDEN</h4>
                <p>Real-time 1v1 action. Dodge enemy attacks and learn their patterns to defeat them.</p>
                <ul className="gameplay-list">
                  <li>Real-time dodging mechanics</li>
                  <li>Boss learns your dodge directions</li>
                  <li>Increasing difficulty as you progress</li>
                  <li>Quick, intense matches</li>
                </ul>
              </div>
              <div className="gameplay-card">
                <h4>⚔️ THE FIVE</h4>
                <p>Lead a squad of 5 warriors in strategic 5v1 battles against an adaptive enemy.</p>
                <ul className="gameplay-list">
                  <li>Squad-based team combat</li>
                  <li>Boss learns squad tactics</li>
                  <li>Character positioning matters</li>
                  <li>Coordinate team actions</li>
                </ul>
              </div>
            </div>
          </div>

          <footer className="landing-footer">
            <p>Adaptive AI Games • Built with React, Express, and MongoDB</p>
            <p className="footer-small">Your data is stored securely in the cloud. Play anywhere, anytime.</p>
          </footer>
        </>
      )}
    </div>
  );
};
