/**
 * The minimal surface GameSDK needs to talk to the outside world. Injected
 * rather than hardcoded to `window` so the SDK's logic is fully unit-testable
 * without a real browser/iframe — see __tests__/game-sdk.test.ts for a fake
 * implementation used in isolation, and __tests__/*.integration.test.ts for
 * one wired directly to a real @adaptive-ai/sdk-host instance.
 */
export interface MessageTransport {
  postMessage(message: unknown, targetOrigin: string): void;
  addEventListener(type: 'message', handler: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', handler: (event: MessageEvent) => void): void;
}

/**
 * Production implementation: posts to the parent frame (the platform host)
 * and listens for messages on this frame's own window. This is the only
 * place in the client package that touches a real `Window`.
 */
export class WindowMessageTransport implements MessageTransport {
  constructor(
    private readonly targetWindow: Window,
    private readonly listenerWindow: Window = globalThis.window
  ) {}

  postMessage(message: unknown, targetOrigin: string): void {
    this.targetWindow.postMessage(message, targetOrigin);
  }

  addEventListener(type: 'message', handler: (event: MessageEvent) => void): void {
    this.listenerWindow.addEventListener(type, handler);
  }

  removeEventListener(type: 'message', handler: (event: MessageEvent) => void): void {
    this.listenerWindow.removeEventListener(type, handler);
  }
}
