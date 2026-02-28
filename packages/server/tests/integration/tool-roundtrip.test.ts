import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it, vi } from 'vitest'
import { createMcpServer } from '../../src/server.ts'
import { ConnectionManager } from '../../src/ws/connection-manager.ts'
import { createWsServer } from '../../src/ws/server.ts'
import { MockAdapter } from '../helpers/mock-adapter.ts'
import { DEBUG_EVENT_FIXTURES } from '../helpers/fixtures.ts'

interface TestLogger {
  debug: ReturnType<typeof vi.fn>
  info: ReturnType<typeof vi.fn>
  warn: ReturnType<typeof vi.fn>
  error: ReturnType<typeof vi.fn>
}

function createLogger(): TestLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

describe('MCP tool roundtrip integration', () => {
  it('roundtrips debug_health_check from MCP client through websocket to the connected adapter', async () => {
    const logger = createLogger()

    const connectionManager = new ConnectionManager({
      REQUEST_TIMEOUT_MS: 1_000,
      logger,
    })

    const wsServer = createWsServer(
      {
        host: '127.0.0.1',
        port: 0,
        allowedOrigins: ['http://localhost:8081'],
      },
      connectionManager,
      logger,
    )

    const adapter = new MockAdapter({
      url: `ws://127.0.0.1:${wsServer.port}`,
      origin: 'http://localhost:8081',
    })

    adapter.setStaticResponse('debug_list_streams', {
      streams: [
        {
          name: 'redux',
          active: true,
          eventCount: 2,
          lastEventAt: null,
        },
      ],
    })

    const mcpServer = createMcpServer(connectionManager, {
      MAX_RESPONSE_CHARS: 50_000,
    })

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

    const client = new Client(
      {
        name: 'integration-test-client',
        version: '1.0.0',
      },
      {
        capabilities: {},
      },
    )

    try {
      await adapter.connect()
      await sleep(50)

      await (mcpServer as { connect: (transport: unknown) => Promise<void> }).connect(serverTransport)
      await client.connect(clientTransport)

      const result = await client.callTool({
        name: 'debug_health_check',
        arguments: {},
      })

      expect(result.isError).toBe(false)
      expect(adapter.getRequests().some(request => request.action === 'debug_list_streams')).toBe(true)
    } finally {
      await client.close()
      await (mcpServer as { close?: () => Promise<void> }).close?.()
      if (adapter.isConnected()) {
        await adapter.disconnect()
      }
      await wsServer.close()
    }
  })

  it('roundtrips debug_get_snapshot from MCP client through websocket and returns the adapter snapshot', async () => {
    const logger = createLogger()

    const connectionManager = new ConnectionManager({
      REQUEST_TIMEOUT_MS: 1_000,
      logger,
    })

    const wsServer = createWsServer(
      {
        host: '127.0.0.1',
        port: 0,
        allowedOrigins: ['http://localhost:8081'],
      },
      connectionManager,
      logger,
    )

    const adapter = new MockAdapter({
      url: `ws://127.0.0.1:${wsServer.port}`,
      origin: 'http://localhost:8081',
    })

    const reduxSnapshot = {
      user: {
        id: 'u-1',
        name: 'Ada',
      },
      todos: [
        {
          id: 't-1',
          title: 'Ship integration test',
          done: false,
        },
      ],
    }

    adapter.setStaticResponse('debug_get_snapshot', {
      snapshot: reduxSnapshot,
    })

    const mcpServer = createMcpServer(connectionManager, {
      MAX_RESPONSE_CHARS: 50_000,
    })

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

    const client = new Client(
      {
        name: 'integration-test-client',
        version: '1.0.0',
      },
      {
        capabilities: {},
      },
    )

    try {
      await adapter.connect()
      await sleep(50)

      await (mcpServer as { connect: (transport: unknown) => Promise<void> }).connect(serverTransport)
      await client.connect(clientTransport)

      const result = await client.callTool({
        name: 'debug_get_snapshot',
        arguments: {
          stream: 'redux',
        },
      })

      expect(result.structuredContent).toEqual({
        snapshot: reduxSnapshot,
      })
      expect(adapter.getRequests().some(request => request.action === 'debug_get_snapshot')).toBe(true)
    } finally {
      await client.close()
      await (mcpServer as { close?: () => Promise<void> }).close?.()
      if (adapter.isConnected()) {
        await adapter.disconnect()
      }
      await wsServer.close()
    }
  })

  it('roundtrips debug_query_events from MCP client through websocket and returns adapter events', async () => {
    const logger = createLogger()

    const connectionManager = new ConnectionManager({
      REQUEST_TIMEOUT_MS: 1_000,
      logger,
    })

    const wsServer = createWsServer(
      {
        host: '127.0.0.1',
        port: 0,
        allowedOrigins: ['http://localhost:8081'],
      },
      connectionManager,
      logger,
    )

    const adapter = new MockAdapter({
      url: `ws://127.0.0.1:${wsServer.port}`,
      origin: 'http://localhost:8081',
    })

    const expectedEventsPayload = {
      events: DEBUG_EVENT_FIXTURES.slice(0, 2),
      hasMore: true,
      oldestSeq: 1,
      latestSeq: 50,
    }

    adapter.setStaticResponse('debug_query_events', expectedEventsPayload)

    const mcpServer = createMcpServer(connectionManager, {
      MAX_RESPONSE_CHARS: 50_000,
    })

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

    const client = new Client(
      {
        name: 'integration-test-client',
        version: '1.0.0',
      },
      {
        capabilities: {},
      },
    )

    try {
      await adapter.connect()
      await sleep(50)

      await (mcpServer as { connect: (transport: unknown) => Promise<void> }).connect(serverTransport)
      await client.connect(clientTransport)

      const result = await client.callTool({
        name: 'debug_query_events',
        arguments: {
          stream: 'redux',
          limit: 2,
        },
      })

      expect(result.structuredContent).toEqual(expectedEventsPayload)
      expect(adapter.getRequests().some(request => request.action === 'debug_query_events')).toBe(true)
    } finally {
      await client.close()
      await (mcpServer as { close?: () => Promise<void> }).close?.()
      if (adapter.isConnected()) {
        await adapter.disconnect()
      }
      await wsServer.close()
    }
  })

  it('returns a NOT_CONNECTED MCP error with actionable guidance when debug_get_snapshot is called before adapter connection', async () => {
    const logger = createLogger()

    const connectionManager = new ConnectionManager({
      REQUEST_TIMEOUT_MS: 1_000,
      logger,
    })

    const mcpServer = createMcpServer(connectionManager, {
      MAX_RESPONSE_CHARS: 50_000,
    })

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

    const client = new Client(
      {
        name: 'integration-test-client',
        version: '1.0.0',
      },
      {
        capabilities: {},
      },
    )

    try {
      await (mcpServer as { connect: (transport: unknown) => Promise<void> }).connect(serverTransport)
      await client.connect(clientTransport)

      const result = await client.callTool({
        name: 'debug_get_snapshot',
        arguments: {
          stream: 'redux',
        },
      })

      expect(result).toMatchObject({
        isError: true,
        content: [{ type: 'text' }],
      })

      const payload = JSON.parse(result.content?.[0]?.text ?? '{}')
      expect(payload).toMatchObject({
        code: 'NOT_CONNECTED',
        message: expect.stringContaining(
          'Start your React Native app with the debug adapter enabled, then retry.',
        ),
      })
    } finally {
      await client.close()
      await (mcpServer as { close?: () => Promise<void> }).close?.()
    }
  })
})
