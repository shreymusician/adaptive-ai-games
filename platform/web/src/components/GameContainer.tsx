import { useNavigate } from 'react-router-dom';
import '../styles/GameContainer.css';

interface GameContainerProps {
  title: string;
  children: React.ReactNode;
  isLoading?: boolean;
  error?: string | null;
}

export const GameContainer = ({ title, children, isLoading, error }: GameContainerProps) => {
  const navigate = useNavigate();

  return (
    <div className="game-container">
      <div className="game-header">
        <button className="back-button" onClick={() => navigate('/')}>
          ← Back
        </button>
        <h2>{title}</h2>
        <div className="header-spacer"></div>
      </div>

      {isLoading && (
        <div className="loading-overlay">
          <div className="spinner"></div>
          <p>Loading game...</p>
        </div>
      )}

      {error && (
        <div className="error-message">
          <p>{error}</p>
          <button onClick={() => window.location.reload()}>Reload</button>
        </div>
      )}

      <div className="game-content">{children}</div>
    </div>
  );
};
