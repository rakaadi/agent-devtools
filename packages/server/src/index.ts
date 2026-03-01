import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createMcpServer as createRealMcpServer } from './server.ts'
import { loadConfig as loadRealConfig } from './types/config.ts'
import type { ConnectionManagerWithInfo } from './types/connection-manager.ts'
import type { LoggerLike } from './types/logger.ts'
import { createLogger as createRealLogger } from './utils/logger.ts'
import { ConnectionManager } from './ws/connection-manager.ts'
import { createWsServer } from './ws/server.ts'
import type { Config } from './types/config.ts'
import type { Logger } from './utils/logger.ts'
import type { McpServerLike } from './server.ts'

interface WsServerHandleLike {
  close?: () => Promise<unknown> | unknown
}

type StartupDeps = {
  loadConfig: () => Config
  createLogger: (config: Config) => Logger
  createConnectionManager: (options: {
    REQUEST_TIMEOUT_MS: number
    logger: Logger
  }) => ConnectionManagerWithInfo
  startWsServer: (
    config: { host: string, port: number },
    connectionManager: ConnectionManagerWithInfo,
    logger: Logger,
  ) => WsServerHandleLike
  createMcpServer: (connectionManager: ConnectionManagerWithInfo, config: Config) => McpServerLike
  createStdioTransport: () => StdioServerTransport
  connectStdioTransport: (
    server: McpServerLike,
    transport: StdioServerTransport,
  ) => Promise<unknown> | unknown
  onSignal: (event: 'SIGINT' | 'SIGTERM', handler: () => void) => unknown
  closeStdioTransport: (transport: StdioServerTransport) => unknown
  processExit: (code: number) => void
}

function createLoggerBridge(logger: Logger): LoggerLike {
  return {
    debug: (...args: unknown[]) => logger.debug(String(args[0] ?? ''), args[1]),
    info: (...args: unknown[]) => logger.info(String(args[0] ?? ''), args[1]),
    warn: (...args: unknown[]) => logger.warn(String(args[0] ?? ''), args[1]),
    error: (...args: unknown[]) => logger.error(String(args[0] ?? ''), args[1]),
  }
}

const defaultDeps: StartupDeps = {
  loadConfig: loadRealConfig,
  createLogger: createRealLogger,
  createConnectionManager: options => new ConnectionManager({
    REQUEST_TIMEOUT_MS: options.REQUEST_TIMEOUT_MS,
    logger: createLoggerBridge(options.logger),
  }),
  startWsServer: (config, connectionManager, logger) => createWsServer(
    { ...config, allowedOrigins: [] },
    connectionManager as unknown as { handleConnection: (socket: unknown) => void },
    createLoggerBridge(logger),
  ),
  createMcpServer: createRealMcpServer,
  createStdioTransport: () => new StdioServerTransport(),
  connectStdioTransport: (server, transport) => server.connect?.(transport),
  onSignal: (event, handler) => process.on(event, handler),
  closeStdioTransport: transport => transport.close(),
  processExit: code => {
    try {
      process.exit(code)
    } catch {
      // Vitest intercepts process.exit in tests.
    }
  },
}

export async function startServer(deps: Partial<StartupDeps> = {}): Promise<void> {
  const {
    loadConfig,
    createLogger,
    createConnectionManager,
    startWsServer,
    createMcpServer,
    createStdioTransport,
    connectStdioTransport,
    onSignal,
    closeStdioTransport,
    processExit,
  } = {
    ...defaultDeps,
    ...deps,
  }

  const config = loadConfig()
  const logger = createLogger(config)
  const connectionManager = createConnectionManager({
    REQUEST_TIMEOUT_MS: config.REQUEST_TIMEOUT_MS,
    logger,
  })

  const wsServer = startWsServer(
    {
      host: config.WS_HOST,
      port: config.WS_PORT,
    },
    connectionManager,
    logger,
  )

  const server = createMcpServer(connectionManager, config)
  const transport = createStdioTransport()
  await connectStdioTransport(server, transport)

  const registeredToolCount = server.registeredTools?.length ?? 0
  const registeredResourceCount = server.registeredResources?.length ?? 0

  logger.info('Server startup summary', {
    websocketEndpoint: `${config.WS_HOST}:${config.WS_PORT}`,
    registeredToolCount,
    registeredResourceCount,
    serverVersion: '0.0.1',
  })

  const handleShutdown = (): void => {
    wsServer.close?.()
    closeStdioTransport(transport)
    processExit(0)
  }

  onSignal('SIGINT', handleShutdown)
  onSignal('SIGTERM', handleShutdown)
}

if (import.meta.main) {
  startServer().catch(error => {
    console.error(error)
    process.exit(1)
  })
}
