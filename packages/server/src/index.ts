import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createMcpServer as createRealMcpServer } from './server.ts'
import { loadConfig as loadRealConfig } from './types/config.ts'
import { createLogger as createRealLogger } from './utils/logger.ts'
import { ConnectionManager } from './ws/connection-manager.ts'
import { createWsServer } from './ws/server.ts'
import type { Config } from './types/config.ts'
import type { Logger } from './utils/logger.ts'
import type { McpServerLike } from './server.ts'

interface ConnectionManagerLike {
  isConnected: () => boolean
  getAdapterInfo: () => unknown
  request: (action: string, params?: Record<string, unknown>) => Promise<unknown>
}

interface WsServerHandleLike {
  close?: () => Promise<unknown> | unknown
}

type StartupDeps = {
  loadConfig: () => Config
  createLogger: (config: Config) => Logger
  createConnectionManager: (options: {
    REQUEST_TIMEOUT_MS: number
    logger: Logger
  }) => ConnectionManagerLike
  startWsServer: (
    config: { host: string, port: number },
    connectionManager: ConnectionManagerLike,
    logger: Logger,
  ) => WsServerHandleLike
  createMcpServer: (connectionManager: ConnectionManagerLike, config: Config) => McpServerLike
  createStdioTransport: () => StdioServerTransport
  connectStdioTransport: (
    server: McpServerLike,
    transport: StdioServerTransport,
  ) => Promise<unknown> | unknown
  onSignal: (event: 'SIGINT' | 'SIGTERM', handler: () => void) => unknown
  closeStdioTransport: (transport: StdioServerTransport) => unknown
  processExit: (code: number) => void
}

const defaultDeps: StartupDeps = {
  loadConfig: loadRealConfig,
  createLogger: createRealLogger,
  createConnectionManager: options => {
    const loggerBridge = {
      debug: (...args: unknown[]) => options.logger.debug(String(args[0] ?? ''), args[1]),
      info: (...args: unknown[]) => options.logger.info(String(args[0] ?? ''), args[1]),
      warn: (...args: unknown[]) => options.logger.warn(String(args[0] ?? ''), args[1]),
      error: (...args: unknown[]) => options.logger.error(String(args[0] ?? ''), args[1]),
    }

    return new ConnectionManager({
      REQUEST_TIMEOUT_MS: options.REQUEST_TIMEOUT_MS,
      logger: loggerBridge,
    })
  },
  startWsServer: (config, connectionManager, logger) => createWsServer(
    {
      ...config,
      allowedOrigins: [],
    },
    connectionManager as unknown as { handleConnection: (socket: unknown) => void },
    {
      debug: (...args: unknown[]) => logger.debug(String(args[0] ?? ''), args[1]),
      info: (...args: unknown[]) => logger.info(String(args[0] ?? ''), args[1]),
      warn: (...args: unknown[]) => logger.warn(String(args[0] ?? ''), args[1]),
      error: (...args: unknown[]) => logger.error(String(args[0] ?? ''), args[1]),
    },
  ),
  createMcpServer: createRealMcpServer,
  createStdioTransport: () => new StdioServerTransport(),
  connectStdioTransport: (server, transport) =>
    (server as unknown as { connect: (receivedTransport: StdioServerTransport) => Promise<unknown> | unknown })
      .connect(transport),
  onSignal: (event, handler) => process.on(event, handler),
  closeStdioTransport: transport => {
    (transport as { close?: () => Promise<unknown> | unknown }).close?.()
  },
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

  const websocketEndpoint = `${config.WS_HOST}:${config.WS_PORT}`
  const registeredTools = server.registeredTools
  const registeredToolCount = Array.isArray(registeredTools)
    ? registeredTools.length
    : 0
  const registeredResources = server.registeredResources
  const registeredResourceCount = Array.isArray(registeredResources)
    ? registeredResources.length
    : 0

  logger.info('Server startup summary', {
    websocketEndpoint,
    registeredToolCount,
    registeredResourceCount,
    serverVersion: '0.0.1',
  })

  const handleShutdown = (): void => {
    (wsServer as { close?: () => Promise<unknown> | unknown }).close?.()
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
