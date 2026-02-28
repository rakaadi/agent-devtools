import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'

interface WsServerConfig {
  host: string
  port: number
  allowedOrigins: string[]
}

interface ConnectionManagerLike {
  handleConnection: (socket: unknown) => void
}

interface LoggerLike {
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

interface WsServerHandle {
  port: number
  close: () => Promise<void>
}

function normalizeHost(host: string): string {
  if (host.startsWith('[')) {
    return host.slice(1).split(']')[0]
  }

  return host.split(':')[0]
}

function createAllowedHosts(configuredHost: string): Set<string> {
  return new Set([
    'localhost',
    '127.0.0.1',
    '::1',
    normalizeHost(configuredHost),
  ])
}

export function createWsServer(
  config: WsServerConfig,
  connectionManager: ConnectionManagerLike,
  logger: LoggerLike,
): WsServerHandle {
  const httpServer = createServer()
  const wsServer = new WebSocketServer({ noServer: true })

  const port = config.port === 0
    ? 30000 + Math.floor(Math.random() * 10000)
    : config.port

  const allowedHosts = createAllowedHosts(config.host)

  httpServer.on('upgrade', (request, socket, head) => {
    const origin = request.headers.origin
    const isAllowed = typeof origin !== 'string' || config.allowedOrigins.includes(origin)

    if (!isAllowed) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      socket.destroy()
      logger.warn('Rejected websocket upgrade from disallowed origin', origin)
      return
    }

    const hostHeader = request.headers.host
    const normalizedHost = typeof hostHeader === 'string'
      ? normalizeHost(hostHeader)
      : ''

    if (!allowedHosts.has(normalizedHost)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      socket.destroy()
      logger.warn('Rejected websocket upgrade from disallowed host', hostHeader)
      return
    }

    wsServer.handleUpgrade(request, socket, head, ws => {
      connectionManager.handleConnection(ws)
    })
  })

  httpServer.listen(port, config.host)

  return {
    port,
    close: () => new Promise((resolve, reject) => {
      wsServer.close()
      httpServer.close(error => {
        if (error) {
          reject(error)
          return
        }

        resolve()
      })
    }),
  }
}
