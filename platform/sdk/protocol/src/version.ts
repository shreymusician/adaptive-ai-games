/**
 * Plugin SDK version. Must be updated whenever the SDK protocol changes.
 * Follows semantic versioning:
 * - MAJOR: breaking message format changes
 * - MINOR: new optional message kinds or fields
 * - PATCH: documentation, non-breaking internal changes
 *
 * The host compares this against pluginsdeclared sdkVersion and rejects
 * incompatible clients at handshake time, preventing silent failures.
 */
export const SDK_VERSION = '0.1.0';

/**
 * Checks if a client version is compatible with the host version.
 * Currently: must match MAJOR.MINOR, allow any PATCH.
 */
export function isCompatibleSdkVersion(clientVersion: string, hostVersion: string): boolean {
  const clientParts = clientVersion.split('.');
  const hostParts = hostVersion.split('.');
  return clientParts[0] === hostParts[0] && clientParts[1] === hostParts[1];
}
