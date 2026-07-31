import { GameContainer } from '../components/GameContainer';

export const FiveGame = () => {
  return (
    <GameContainer title="THE FIVE">
      <iframe
        src="/games/the-five.html"
        title="THE FIVE"
        className="game-frame"
        allow="autoplay"
      />
    </GameContainer>
  );
};
