/**
 * The minimal surface mountPlugin needs to talk to a single mounted plugin.
 * Injected rather than hardcoded to a real iframe so the host's mounting/
 * request-response logic is fully unit-testable without jsdom or a real
 * browser — see __tests__/mount-plugin.test.ts.
 */
export interface HostTransport {
  postToPlugin(message: unknown, targetOrigin: string): void;
  onMessageFromPlugin(handler: (event: MessageEvent) => void): void;
  offMessageFromPlugin(handler: (event: MessageEvent) => void): void;
}

/**
 * Production implementation: posts into a specific iframe's contentWindow
 * and listens on the parent window, filtering incoming messages to only
 * those whose `source` is that exact iframe — this is what lets multiple
 * plugins be mounted simultaneously without cross-talk, and is the other
 * half (alongside SDK_MESSAGE_CHANNEL) of rejecting traffic that isn't
 * genuinely from this plugin.
 */
export class WindowHostTransport implements HostTransport {
  private readonly listeners = new Map<(event: MessageEvent) => void, (event: MessageEvent) => void>();

  constructor(
    private readonly iframeWindow: () => Window | null,
    private readonly listenerWindow: Window = globalThis.window
  ) {}

  postToPlugin(message: unknown, targetOrigin: string): void {
    const win = this.iframeWindow();
    if (!win) return; // plugin not loaded yet, or already unmounted — drop silently
    win.postMessage(message, targetOrigin);
  }

  onMessageFromPlugin(handler: (event: MessageEvent) => void): void {
    const filtered = (event: MessageEvent): void => {
      if (event.source !== this.iframeWindow()) return;
      handler(event);
    };
    this.listeners.set(handler, filtered);
    this.listenerWindow.addEventListener('message', filtered);
  }

  offMessageFromPlugin(handler: (event: MessageEvent) => void): void {
    const filtered = this.listeners.get(handler);
    if (!filtered) return;
    this.listenerWindow.removeEventListener('message', filtered);
    this.listeners.delete(handler);
  }
}
