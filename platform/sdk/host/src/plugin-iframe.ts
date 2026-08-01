import { GamePluginManifest } from '@adaptive-ai/sdk-protocol';
import { WindowHostTransport } from './transport';

export interface IframeLoadOptions {
  /** DOM element to mount the iframe into. If not provided, the iframe is created but not attached. */
  container?: HTMLElement;
  /** Additional attributes to set on the iframe element. */
  attributes?: Record<string, string>;
}

/**
 * Creates and mounts an iframe containing a game plugin, with secure sandbox
 * attributes. Returns the iframe element and the transport for communicating
 * with it. Must be mounted into the document or have onLoad/onError handlers
 * wired before calling start on the mounted plugin.
 */
export function createPluginIframe(
  manifest: GamePluginManifest,
  options: IframeLoadOptions = {}
): { iframe: HTMLIFrameElement; transport: WindowHostTransport } {
  const iframe = document.createElement('iframe');

  // Security: apply minimal necessary sandbox attributes
  // allow-scripts: plugins need to run JS
  // allow-same-origin or allow-top-level-navigation: evaluated per-plugin, currently omitted
  iframe.sandbox.add('allow-scripts');

  iframe.src = manifest.entryUrl;
  iframe.title = manifest.displayName;

  // Prevent accidental leaks
  iframe.referrerPolicy = 'no-referrer';

  // Apply any additional attributes provided
  if (options.attributes) {
    for (const [key, value] of Object.entries(options.attributes)) {
      iframe.setAttribute(key, value);
    }
  }

  // Mount into container if provided
  if (options.container) {
    options.container.appendChild(iframe);
  }

  // Create transport: window.parent (the page the iframe is in) for listening,
  // and the iframe's contentWindow for posting
  const transport = new WindowHostTransport(() => iframe.contentWindow, window);

  return { iframe, transport };
}

/**
 * Cleans up an iframe and its associated resources. Waits for in-flight
 * requests to settle before removing, so unmount can properly reject them.
 */
export async function destroyPluginIframe(iframe: HTMLIFrameElement): Promise<void> {
  // Remove from DOM if attached
  if (iframe.parentElement) {
    iframe.parentElement.removeChild(iframe);
  }

  // Give pending requests a small window to complete or timeout
  // (the actual timeout management is in mountPlugin, this just gives cleanup time)
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Clear src to prevent further navigation
  iframe.src = '';
}
