import { GameContainer } from '../components/GameContainer';

export const WardenGame = () => {
  return (
    <GameContainer title="WARDEN">
      <iframe
        src="/games/warden.html"
        title="WARDEN"
        className="game-frame"
        allow="autoplay"
      />
    </GameContainer>
  );
};
