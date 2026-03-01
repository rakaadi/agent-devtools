/**
 * Minimal connection manager interface for tools and resources
 * that only need connectivity checks and request capability.
 */
export interface ConnectionManagerLike {
  isConnected: () => boolean
  request: (action: string, params?: Record<string, unknown>) => Promise<unknown>
}

/**
 * Extended connection manager interface for consumers that also
 * need adapter metadata (e.g., health-check tool, MCP server registration).
 */
export interface ConnectionManagerWithInfo extends ConnectionManagerLike {
  getAdapterInfo: () => unknown
}
