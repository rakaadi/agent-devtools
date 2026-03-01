/**
 * Minimal logger interface for internal use across the WebSocket
 * layer and connection manager.
 */
export interface LoggerLike {
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}
