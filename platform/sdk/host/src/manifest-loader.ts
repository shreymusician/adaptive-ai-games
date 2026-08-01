import { GamePluginManifest, isGamePluginManifest } from '@adaptive-ai/sdk-protocol';

/**
 * Loads and validates a GamePluginManifest from JSON. Throws if the JSON is
 * malformed or doesn't satisfy the schema. Returns the validated manifest
 * ready to use with mountPlugin or loadPlugin.
 */
export async function loadManifest(url: string): Promise<GamePluginManifest> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load manifest from ${url}: ${response.status} ${response.statusText}`);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (error) {
    throw new Error(`Failed to parse manifest JSON from ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isGamePluginManifest(data)) {
    throw new Error(`Manifest from ${url} does not satisfy GamePluginManifest schema`);
  }

  return data;
}

/**
 * Validates a manifest object (already parsed) against the GamePluginManifest
 * schema. Throws if invalid. Useful for testing or loading from in-memory
 * objects rather than fetching from a URL.
 */
export function validateManifest(data: unknown): GamePluginManifest {
  if (!isGamePluginManifest(data)) {
    throw new Error('Data does not satisfy GamePluginManifest schema');
  }
  return data;
}
