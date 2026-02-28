import { describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'
import { MockAdapter } from '../helpers/mock-adapter.ts'
import { ConnectionManager } from '../../src/ws/connection-manager.ts'
import { createWsServer } from '../../src/ws/server.ts'

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

function waitForUpgradeOutcome(client: WebSocket): Promise<'open' | 'error'> {
  return new Promise<'open' | 'error'>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for websocket upgrade outcome'))
    }, 1000)

    client.once('open', () => {
      clearTimeout(timeout)
      resolve('open')
    })

    client.once('error', () => {
      clearTimeout(timeout)
      resolve('error')
    })
  })
}

describe('WebSocket connection integration', () => {
  it('marks the connection as connected after a valid adapter handshake', async () => {
    const logger = createLogger()

    const connectionManager = new ConnectionManager({
      REQUEST_TIMEOUT_MS: 500,
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

    try {
      await adapter.connect()
      await sleep(50)

      expect(connectionManager.isConnected()).toBe(true)
    } finally {
      if (adapter.isConnected()) {
        await adapter.disconnect()
      }
      await wsServer.close()
    }
  })

  it('marks the connection as disconnected after adapter disconnects following a successful handshake', async () => {
    const logger = createLogger()

    const connectionManager = new ConnectionManager({
      REQUEST_TIMEOUT_MS: 500,
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

    try {
      await adapter.connect()
      await sleep(50)

      await adapter.disconnect()
      await sleep(50)

      expect(connectionManager.isConnected()).toBe(false)
    } finally {
      if (adapter.isConnected()) {
        await adapter.disconnect()
      }
      await wsServer.close()
    }
  })

  it('rejects websocket upgrades with a disallowed Origin header', async () => {
    const logger = createLogger()

    const connectionManager = new ConnectionManager({
      REQUEST_TIMEOUT_MS: 500,
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

    const client = new WebSocket(`ws://127.0.0.1:${wsServer.port}`, {
      headers: {
        origin: 'http://malicious.example.com',
      },
    })

    try {
      const outcome = await waitForUpgradeOutcome(client)

      expect(outcome).toBe('error')
    } finally {
      client.close()
      await wsServer.close()
    }
  })

  it('rejects websocket upgrades with a disallowed Host header', async () => {
    const logger = createLogger()

    const connectionManager = new ConnectionManager({
      REQUEST_TIMEOUT_MS: 500,
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

    const client = new WebSocket(`ws://127.0.0.1:${wsServer.port}`, {
      headers: {
        origin: 'http://localhost:8081',
        host: 'evil.example.com',
      },
    })

    try {
      const outcome = await waitForUpgradeOutcome(client)

      expect(outcome).toBe('error')
    } finally {
      client.close()
      await wsServer.close()
    }
  })

  it('replaces an existing adapter connection and rejects its in-flight request', async () => {
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

    const firstAdapter = new MockAdapter({
      url: `ws://127.0.0.1:${wsServer.port}`,
      origin: 'http://localhost:8081',
    })

    const secondAdapter = new MockAdapter({
      url: `ws://127.0.0.1:${wsServer.port}`,
      origin: 'http://localhost:8081',
      sessionId: 'replacement-session',
    })

    firstAdapter.setRequestHandler('slow_action', async () => {
      await new Promise(() => {})
    })

    try {
      await firstAdapter.connect()
      await sleep(50)

      const pendingRequest = connectionManager.request('slow_action')
      const pendingError = pendingRequest.then(
        () => new Error('Expected request to reject'),
        error => error as Error,
      )

      await new Promise<void>((resolve, reject) => {
        const startedAt = Date.now()
        const timeoutMs = 1_000

        const check = (): void => {
          if (firstAdapter.getRequests().length > 0) {
            resolve()
            return
          }

          if (Date.now() - startedAt > timeoutMs) {
            reject(new Error('Timed out waiting for first adapter to receive request'))
            return
          }

          setTimeout(check, 10)
        }

        check()
      })

      await secondAdapter.connect()

      const error = await pendingError
      expect(error.message).toContain('Connection replaced')
    } finally {
      if (firstAdapter.isConnected()) {
        await firstAdapter.disconnect()
      }
      if (secondAdapter.isConnected()) {
        await secondAdapter.disconnect()
      }
      await wsServer.close()
    }
  })
})
