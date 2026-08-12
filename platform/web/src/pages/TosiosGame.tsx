import { useEffect, useState } from 'react';
import { GameContainer } from '../components/GameContainer';
import { matchAPI } from '../services/api';

const TOSIOS_URL = import.meta.env.VITE_TOSIOS_URL || 'http://localhost:3001';

export const TosiosGame = () => {
  const [iframeSrc, setIframeSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // POST /api/match/start (Milestone 1c) — the platform API is the only
    // authority that mints this token; it's bound to the authenticated
    // user's real playerId via their existing session, never a value this
    // page constructs or a URL param it trusts. The token is then handed to
    // the TOSIOS server unmodified for it to verify.
    matchAPI
      .start('tosios')
      .then(({ matchToken }) => {
        if (cancelled) return;
        setIframeSrc(`${TOSIOS_URL}/?matchToken=${encodeURIComponent(matchToken)}`);
      })
      .catch(() => {
        if (cancelled) return;
        setError('Could not start a match right now. Please try again.');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <GameContainer title="ADAPTIVE AI" isLoading={!iframeSrc && !error} error={error}>
      {iframeSrc && (
        <iframe
          src={iframeSrc}
          title="Adaptive AI"
          className="game-frame tosios-frame"
          allow="autoplay"
        />
      )}
    </GameContainer>
  );
};
