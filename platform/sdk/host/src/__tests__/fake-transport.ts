import { HostTransport } from '../transport';

/**
 * An in-memory HostTransport for tests — no window, no iframe, no jsdom.
 * Captures every outgoing postToPlugin call and lets a test simulate an
 * incoming message from the plugin by calling `simulateIncoming`.
 */
export class FakeHostTransport implements HostTransport {
  public readonly sent: Array<{ message: unknown; targetOrigin: string }> = [];
  private handlers: Array<(event: MessageEvent) => void> = [];

  postToPlugin(message: unknown, targetOrigin: string): void {
    this.sent.push({ message, targetOrigin });
  }

  onMessageFromPlugin(handler: (event: MessageEvent) => void): void {
    this.handlers.push(handler);
  }

  offMessageFromPlugin(handler: (event: MessageEvent) => void): void {
    this.handlers = this.handlers.filter((h) => h !== handler);
  }

  simulateIncoming(data: unknown): void {
    const event = { data } as MessageEvent;
    for (const handler of this.handlers) handler(event);
  }

  get listenerCount(): number {
    return this.handlers.length;
  }

  /** Convenience for tests: pull the requestId off the most recently sent message. */
  lastRequestId(): string {
    const last = this.sent[this.sent.length - 1]?.message as { requestId?: string } | undefined;
    if (!last?.requestId) throw new Error('No requestId on last sent message');
    return last.requestId;
  }
}
