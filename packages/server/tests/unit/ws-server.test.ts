import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'
import { createWsServer } from '../../src/ws/server.ts'

describe('createWsServer', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('accepts allowed localhost origin upgrades and delegates connection once while rejecting disallowed origins', async () => {
    // Arrange
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    const connectionManager = {
      handleConnection: vi.fn(),
    }

    const server = createWsServer(
      {
        host: '127.0.0.1',
        port: 0,
        allowedOrigins: ['http://localhost:8081'],
      },
      connectionManager,
      logger,
    )

    const assignedPort = (server as { port?: number }).port

    // Act
    const allowed = new WebSocket(`ws://127.0.0.1:${assignedPort}`, {
      headers: { origin: 'http://localhost:8081' },
    })

    await new Promise<void>((resolve, reject) => {
      allowed.once('open', () => resolve())
      allowed.once('error', reject)
    })

    const disallowed = new WebSocket(`ws://127.0.0.1:${assignedPort}`, {
      headers: { origin: 'https://evil.example.com' },
    })

    const disallowedError = await new Promise<Error>(resolve => {
      disallowed.once('error', error => resolve(error as Error))
    })

    // Assert
    expect(connectionManager.handleConnection).toHaveBeenCalledTimes(1)
    expect(disallowedError).toBeInstanceOf(Error)

    allowed.close()
    disallowed.close()
    await server.close()
  })

  it('accepts upgrades without an origin header and delegates the connection', async () => {
    // Arrange
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    const connectionManager = {
      handleConnection: vi.fn(),
    }

    const server = createWsServer(
      {
        host: '127.0.0.1',
        port: 0,
        allowedOrigins: ['http://localhost:8081'],
      },
      connectionManager,
      logger,
    )

    const assignedPort = (server as { port?: number }).port

    // Act
    const client = new WebSocket(`ws://127.0.0.1:${assignedPort}`)

    await new Promise<void>((resolve, reject) => {
      client.once('open', () => resolve())
      client.once('error', reject)
    })

    // Assert
    expect(connectionManager.handleConnection).toHaveBeenCalledTimes(1)

    client.close()
    await server.close()
  })
})
