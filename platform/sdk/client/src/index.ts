import { GameSDK } from './game-sdk';
import { WindowMessageTransport } from './transport';

export { GameSDK } from './game-sdk';
export type { LegalActionsProvider, DecisionHandler } from './game-sdk';
export { WindowMessageTransport } from './transport';
export type { MessageTransport } from './transport';

export interface CreateGameSDKOptions {
  /** Origin to restrict outgoing postMessage calls to. Defaults to '*' for
   *  local/dev flexibility across ports — plugins should pass the real
   *  platform origin in production. */
  targetOrigin?: string;
}

/**
 * Production entry point for a plugin: wires a GameSDK to the real window
 * (posting to `window.parent`, listening on this frame's own window) and
 * starts it immediately. This is the only function in this package that
 * touches a real browser global — everything else is unit-testable in
 * isolation via an injected MessageTransport.
 */
export function createGameSDK(options: CreateGameSDKOptions = {}): GameSDK {
  const transport = new WindowMessageTransport(window.parent, window);
  const sdk = new GameSDK(transport, options.targetOrigin ?? '*');
  sdk.start();
  return sdk;
}
