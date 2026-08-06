/**
 * TOSIOS's GamePluginManifest — the third SDK surface (static, declared
 * once). `entryUrl` is left as a placeholder: TOSIOS's actual client bundle
 * hosting/URL is a deployment concern out of scope for Phase 10A (adapter
 * layer only — see README "Status").
 */
import { GamePluginManifest } from '@adaptive-ai/sdk-protocol';

export const TOSIOS_MANIFEST: GamePluginManifest = {
  id: 'tosios',
  displayName: 'TOSIOS',
  version: '0.1.0',
  upstreamVersion: '98de136e524d25c5877adc9523c9445bc2b4a262',
  entryUrl: 'https://example.com/tosios/index.html',
  eventSchemaVersion: '1',
  supportsAIOpponent: true,
  license: {
    spdxId: 'MIT',
    noticeUrl: 'https://raw.githubusercontent.com/halftheopposite/TOSIOS/98de136e524d25c5877adc9523c9445bc2b4a262/LICENSE',
    upstreamRepo: 'https://github.com/halftheopposite/TOSIOS',
  },
  legalActionSpace: 'tosios-actions-v1',
};
