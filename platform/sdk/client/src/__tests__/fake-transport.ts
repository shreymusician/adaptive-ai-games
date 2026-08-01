import { SDK_MESSAGE_CHANNEL, SDK_VERSION } from '@adaptive-ai/sdk-protocol';
import { MessageTransport } from '../transport';

/**
 * An in-memory MessageTransport for tests — no window, no iframe, no jsdom.
 * Captures every outgoing postMessage call and lets a test simulate an
 * incoming message by calling `simulateIncoming`.
 */
export class FakeMessageTransport implements MessageTransport {
  public readonly sent: Array<{ message: unknown; targetOrigin: string }> = [];
  private handlers: Array<(event: MessageEvent) => void> = [];

  postMessage(message: unknown, targetOrigin: string): void {
    this.sent.push({ message, targetOrigin });
  }

  addEventListener(_type: 'message', handler: (event: MessageEvent) => void): void {
    this.handlers.push(handler);
  }

  removeEventListener(_type: 'message', handler: (event: MessageEvent) => void): void {
    this.handlers = this.handlers.filter((h) => h !== handler);
  }

  simulateIncoming(data: unknown): void {
    const event = { data } as MessageEvent;
    for (const handler of this.handlers) handler(event);
  }

  get listenerCount(): number {
    return this.handlers.length;
  }

  /**
   * Helper for tests: complete the handshake by responding to the client's
   * greeting with a host greeting, accepting the connection.
   */
  simulateHandshakeAccepted(): void {
    this.simulateIncoming({
      channel: SDK_MESSAGE_CHANNEL,
      kind: 'hostGreeting',
      accepted: true,
      sdkVersion: SDK_VERSION,
      agreedSchemaVersion: '1',
    });
  }
}
