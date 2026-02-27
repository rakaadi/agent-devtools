import { describe, expect, it, vi } from 'vitest'
import * as entrypoint from '../../src/index.ts'

describe('startServer', () => {
  it('loads config, wires startup dependencies in order, and connects MCP over stdio', async () => {
    // Arrange
    const startupOrder: string[] = []

    const config = {
      REQUEST_TIMEOUT_MS: 5000,
      WS_HOST: '127.0.0.1',
      WS_PORT: 19850,
      MAX_PAYLOAD_SIZE: 1048576,
      MAX_RESPONSE_CHARS: 50000,
      LOG_LEVEL: 'info' as const,
    }

    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    const connectionManager = { id: 'connection-manager' }
    const wsServer = { id: 'ws-server' }
    const mcpServer = { id: 'mcp-server' }
    const stdioTransport = { id: 'stdio-transport' }

    const loadConfig = vi.fn(() => {
      startupOrder.push('load config')
      return config
    })

    const createLogger = vi.fn(receivedConfig => {
      startupOrder.push('create logger')
      expect(receivedConfig).toBe(config)
      return logger
    })

    const createConnectionManager = vi.fn(receivedOptions => {
      startupOrder.push('create connection manager')
      expect(receivedOptions).toEqual({
        REQUEST_TIMEOUT_MS: config.REQUEST_TIMEOUT_MS,
        logger,
      })
      return connectionManager
    })

    const startWsServer = vi.fn((receivedConfig, receivedConnectionManager, receivedLogger) => {
      startupOrder.push('start ws server')
      expect(receivedConfig).toEqual({
        host: config.WS_HOST,
        port: config.WS_PORT,
      })
      expect(receivedConnectionManager).toBe(connectionManager)
      expect(receivedLogger).toBe(logger)
      return wsServer
    })

    const createMcpServer = vi.fn((receivedConnectionManager, receivedConfig) => {
      startupOrder.push('create MCP server')
      expect(receivedConnectionManager).toBe(connectionManager)
      expect(receivedConfig).toBe(config)
      return mcpServer
    })

    const connectStdioTransport = vi.fn(async (receivedServer, receivedTransport) => {
      startupOrder.push('connect stdio transport')
      expect(receivedServer).toBe(mcpServer)
      expect(receivedTransport).toBe(stdioTransport)
    })

    const createStdioTransport = vi.fn(() => stdioTransport)

    // Act
    await entrypoint.startServer({
      loadConfig,
      createLogger,
      createConnectionManager,
      startWsServer,
      createMcpServer,
      createStdioTransport,
      connectStdioTransport,
    })

    // Assert
    expect(startupOrder).toEqual([
      'load config',
      'create logger',
      'create connection manager',
      'start ws server',
      'create MCP server',
      'connect stdio transport',
    ])

    expect(startWsServer).toHaveReturnedWith(wsServer)
  })

  it('registers SIGINT and SIGTERM handlers that gracefully close ws server and stdio transport', async () => {
    // Arrange
    const config = {
      REQUEST_TIMEOUT_MS: 5000,
      WS_HOST: '127.0.0.1',
      WS_PORT: 19850,
      MAX_PAYLOAD_SIZE: 1048576,
      MAX_RESPONSE_CHARS: 50000,
      LOG_LEVEL: 'info' as const,
    }

    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    const connectionManager = { id: 'connection-manager' }
    const wsServer = { close: vi.fn() }
    const mcpServer = { id: 'mcp-server' }
    const stdioTransport = { id: 'stdio-transport' }

    const loadConfig = vi.fn(() => config)
    const createLogger = vi.fn(() => logger)
    const createConnectionManager = vi.fn(() => connectionManager)
    const startWsServer = vi.fn(() => wsServer)
    const createMcpServer = vi.fn(() => mcpServer)
    const createStdioTransport = vi.fn(() => stdioTransport)
    const connectStdioTransport = vi.fn(async () => undefined)
    const closeStdioTransport = vi.fn()
    const onSignal = vi.fn()

    // Act
    await entrypoint.startServer({
      loadConfig,
      createLogger,
      createConnectionManager,
      startWsServer,
      createMcpServer,
      createStdioTransport,
      connectStdioTransport,
      closeStdioTransport,
      onSignal,
    } as never)

    // Assert
    expect(onSignal).toHaveBeenCalledWith('SIGINT', expect.any(Function))
    expect(onSignal).toHaveBeenCalledWith('SIGTERM', expect.any(Function))

    const sigintHandler = onSignal.mock.calls.find(([event]) => event === 'SIGINT')?.[1]
    const sigtermHandler = onSignal.mock.calls.find(([event]) => event === 'SIGTERM')?.[1]

    expect(sigintHandler).toBeTypeOf('function')
    expect(sigtermHandler).toBeTypeOf('function')

    sigintHandler?.()
    sigtermHandler?.()

    expect(wsServer.close).toHaveBeenCalledTimes(2)
    expect(closeStdioTransport).toHaveBeenCalledTimes(2)
    expect(closeStdioTransport).toHaveBeenCalledWith(stdioTransport)
  })

  it('calls processExit(0) after shutdown handlers close ws server and stdio transport for SIGINT and SIGTERM', async () => {
    // Arrange
    const config = {
      REQUEST_TIMEOUT_MS: 5000,
      WS_HOST: '127.0.0.1',
      WS_PORT: 19850,
      MAX_PAYLOAD_SIZE: 1048576,
      MAX_RESPONSE_CHARS: 50000,
      LOG_LEVEL: 'info' as const,
    }

    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    const connectionManager = { id: 'connection-manager' }
    const wsServer = { close: vi.fn() }
    const mcpServer = { id: 'mcp-server' }
    const stdioTransport = { id: 'stdio-transport' }

    const loadConfig = vi.fn(() => config)
    const createLogger = vi.fn(() => logger)
    const createConnectionManager = vi.fn(() => connectionManager)
    const startWsServer = vi.fn(() => wsServer)
    const createMcpServer = vi.fn(() => mcpServer)
    const createStdioTransport = vi.fn(() => stdioTransport)
    const connectStdioTransport = vi.fn(async () => undefined)
    const closeStdioTransport = vi.fn()
    const onSignal = vi.fn()
    const processExit = vi.fn()

    await entrypoint.startServer({
      loadConfig,
      createLogger,
      createConnectionManager,
      startWsServer,
      createMcpServer,
      createStdioTransport,
      connectStdioTransport,
      closeStdioTransport,
      onSignal,
      processExit,
    } as never)

    const sigintHandler = onSignal.mock.calls.find(([event]) => event === 'SIGINT')?.[1]
    const sigtermHandler = onSignal.mock.calls.find(([event]) => event === 'SIGTERM')?.[1]

    // Act
    sigintHandler?.()
    sigtermHandler?.()

    // Assert
    expect(processExit).toHaveBeenNthCalledWith(1, 0)
    expect(processExit).toHaveBeenNthCalledWith(2, 0)
  })

  it('logs startup summary with websocket endpoint and registered tool/resource counts when available', async () => {
    // Arrange
    const config = {
      REQUEST_TIMEOUT_MS: 5000,
      WS_HOST: '127.0.0.1',
      WS_PORT: 19850,
      MAX_PAYLOAD_SIZE: 1048576,
      MAX_RESPONSE_CHARS: 50000,
      LOG_LEVEL: 'info' as const,
    }

    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    const loadConfig = vi.fn(() => config)
    const createLogger = vi.fn(() => logger)
    const createConnectionManager = vi.fn(() => ({ id: 'connection-manager' }))
    const startWsServer = vi.fn(() => ({ close: vi.fn() }))
    const createMcpServer = vi.fn(() => ({
      registeredTools: ['debug_health_check', 'debug_list_streams'],
      registeredResources: ['session'],
    }))
    const createStdioTransport = vi.fn(() => ({ id: 'stdio-transport' }))
    const connectStdioTransport = vi.fn(async () => undefined)

    // Act
    await entrypoint.startServer({
      loadConfig,
      createLogger,
      createConnectionManager,
      startWsServer,
      createMcpServer,
      createStdioTransport,
      connectStdioTransport,
    } as never)

    // Assert
    expect(logger.info).toHaveBeenCalledWith(
      'Server startup summary',
      {
        websocketEndpoint: '127.0.0.1:19850',
        registeredToolCount: 2,
        registeredResourceCount: 1,
        serverVersion: '0.0.1',
      },
    )
  })
})
