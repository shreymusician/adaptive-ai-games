import { GamePluginManifest } from '@adaptive-ai/sdk-protocol';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadManifest, validateManifest } from '../manifest-loader';

const validManifest: GamePluginManifest = {
  id: 'test-game',
  displayName: 'Test Game',
  version: '1.0.0',
  upstreamVersion: 'abc123def',
  entryUrl: 'https://example.com/game.html',
  eventSchemaVersion: '1',
  supportsAIOpponent: true,
  legalActionSpace: 'tosios-actions-v1',
  license: {
    spdxId: 'MIT',
    noticeUrl: 'https://example.com/LICENSE',
    upstreamRepo: 'https://github.com/upstream/game',
  },
};

describe('validateManifest', () => {
  it('accepts a valid manifest', () => {
    const result = validateManifest(validManifest);
    expect(result).toEqual(validManifest);
  });

  it('rejects manifest with missing required field', () => {
    const invalid = { ...validManifest, id: undefined };
    expect(() => validateManifest(invalid)).toThrow();
  });

  it('rejects manifest with wrong type for a field', () => {
    const invalid = { ...validManifest, supportsAIOpponent: 'yes' };
    expect(() => validateManifest(invalid)).toThrow();
  });

  it('rejects non-objects', () => {
    expect(() => validateManifest('not an object')).toThrow();
    expect(() => validateManifest(null)).toThrow();
    expect(() => validateManifest(42)).toThrow();
  });
});

describe('loadManifest', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('fetches and validates a manifest from a URL', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => validManifest,
    });

    const result = await loadManifest('https://example.com/manifest.json');
    expect(result).toEqual(validManifest);
    expect(global.fetch).toHaveBeenCalledWith('https://example.com/manifest.json');
  });

  it('rejects if fetch fails', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    await expect(loadManifest('https://example.com/manifest.json')).rejects.toThrow('Failed to load manifest');
  });

  it('rejects if JSON parsing fails', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => {
        throw new Error('Invalid JSON');
      },
    });

    await expect(loadManifest('https://example.com/manifest.json')).rejects.toThrow('parse manifest JSON');
  });

  it('rejects if the fetched JSON does not satisfy the schema', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'test' }), // incomplete manifest
    });

    await expect(loadManifest('https://example.com/manifest.json')).rejects.toThrow('does not satisfy GamePluginManifest schema');
  });
});
