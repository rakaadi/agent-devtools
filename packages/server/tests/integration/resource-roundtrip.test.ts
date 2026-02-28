import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it, vi } from 'vitest'
import { createMcpServer } from '../../src/server.ts'
import { ConnectionManager } from '../../src/ws/connection-manager.ts'
import { createWsServer } from '../../src/ws/server.ts'
import { MockAdapter } from '../helpers/mock-adapter.ts'

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

describe('MCP resource roundtrip integration', () => {
  it('reads session, redux, and navigation resources through MCP and returns adapter-backed content', async () => {
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
      sessionId: 'session-integration-1',
      adapterVersion: 'mock-adapter/2.0.0',
      streams: ['redux', 'navigation'],
      deviceInfo: { platform: 'ios', appVersion: '1.0.0' },
    })

    const reduxSnapshot = {
      counter: 3,
      user: { id: 'u-1', name: 'Ada' },
    }

    const navigationSnapshot = {
      index: 1,
      routes: [{ name: 'Home' }, { name: 'Details' }],
    }

    adapter.setRequestHandler('debug_get_snapshot', request => {
      const stream = (request.params as { stream?: string } | undefined)?.stream
      if (stream === 'redux') {
        return { snapshot: reduxSnapshot }
      }
      if (stream === 'navigation') {
        return { snapshot: navigationSnapshot }
      }
      throw new Error(`Unexpected stream: ${String(stream)}`)
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

      const sessionResult = await client.readResource({ uri: 'debug://session/current' })
      const reduxResult = await client.readResource({ uri: 'debug://redux/state' })
      const navigationResult = await client.readResource({ uri: 'debug://navigation/state' })

      expect(JSON.parse(sessionResult.contents[0].text ?? '{}')).toMatchObject({
        sessionId: 'session-integration-1',
        adapterVersion: 'mock-adapter/2.0.0',
        streams: ['redux', 'navigation'],
        deviceInfo: { platform: 'ios', appVersion: '1.0.0' },
      })
      expect(JSON.parse(reduxResult.contents[0].text ?? '{}')).toEqual(reduxSnapshot)
      expect(JSON.parse(navigationResult.contents[0].text ?? '{}')).toEqual(navigationSnapshot)

      const snapshotRequests = adapter.getRequests().filter(request => request.action === 'debug_get_snapshot')
      expect(snapshotRequests).toHaveLength(2)
      expect(snapshotRequests.map(request => (request.params as { stream?: string } | undefined)?.stream)).toEqual([
        'redux',
        'navigation',
      ])
    } finally {
      await client.close()
      await (mcpServer as { close?: () => Promise<void> }).close?.()
      if (adapter.isConnected()) {
        await adapter.disconnect()
      }
      await wsServer.close()
    }
  })
})
