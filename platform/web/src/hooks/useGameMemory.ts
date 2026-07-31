import { useState, useEffect, useCallback } from 'react';
import { memoryManager } from '../services/memoryManager';

export const useGameMemory = (gameType: string) => {
  const [memory, setMemory] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadMemory = async () => {
      setLoading(true);
      setError(null);
      try {
        const loadedMemory = await memoryManager.loadGameMemory(gameType);
        setMemory(loadedMemory);
      } catch (err) {
        setError('Failed to load game memory');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    loadMemory();
  }, [gameType]);

  const saveMemory = useCallback(
    async (newMemory: Record<string, any>) => {
      setMemory(newMemory);
      try {
        await memoryManager.saveGameMemory(gameType, newMemory);
      } catch (err) {
        setError('Failed to save game memory');
        console.error(err);
      }
    },
    [gameType]
  );

  const logMatch = useCallback(
    async (won: boolean, durationSeconds: number) => {
      try {
        await memoryManager.logMatch(gameType, won, durationSeconds);
      } catch (err) {
        setError('Failed to log match');
        console.error(err);
      }
    },
    [gameType]
  );

  return {
    memory,
    saveMemory,
    logMatch,
    loading,
    error,
  };
};
