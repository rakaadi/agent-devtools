import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'
import { MockWsServer } from '../../helpers/mock-ws-server.ts'
import { createWsClient } from '../../../src/transport/ws-client.ts'

function createConfig(serverUrl: string): {
  serverUrl: string
  sessionId: string
  adapterVersion: string
  enabledStreams: string[]
  deviceInfo: { platform: string }
  connectTimeout: number
  reconnectBaseDelay: number
  reconnectMaxDelay: number
  maxMessageSize: number
  debug: boolean
} {
  return {
    serverUrl,
    sessionId: 'session-test',
    adapterVersion: '0.0.1',
    enabledStreams: ['redux'],
    deviceInfo: { platform: 'test' },
    connectTimeout: 500,
    reconnectBaseDelay: 10,
    reconnectMaxDelay: 100,
    maxMessageSize: 512 * 1024,
    debug: false,
  }
}

function createHandlers(): {
  get_snapshot: ReturnType<typeof vi.fn>
  query_events: ReturnType<typeof vi.fn>
} {
  return {
    get_snapshot: vi.fn(async (params?: Record<string, unknown>) => ({
      kind: 'snapshot',
      params: params ?? null,
    })),
    query_events: vi.fn(async () => ({ events: [] })),
  }
}

describe('createWsClient', () => {
  let server: MockWsServer | null = null
  const originalWebSocket = globalThis.WebSocket

  beforeEach(() => {
    ;(globalThis as { WebSocket?: typeof WebSocket }).WebSocket = WebSocket as unknown as typeof globalThis.WebSocket
  })

  afterEach(async () => {
    await server?.stop()
    server = null
    ;(globalThis as { WebSocket?: typeof originalWebSocket }).WebSocket = originalWebSocket
    vi.restoreAllMocks()
  })

  it('rejects server URLs that do not start with ws:// or wss://', () => {
    expect(() => createWsClient(
      createConfig('http://127.0.0.1:19850') as never,
      createHandlers() as never,
    )).toThrow(/wss?:\/\//)
  })

  it('connects and sends handshake message when socket opens', async () => {
    server = new MockWsServer()
    await server.start()

    const client = createWsClient(createConfig(server.url) as never, createHandlers() as never) as {
      connect: () => Promise<void>
      disconnect: () => Promise<void> | void
      isConnected: () => boolean
    }

    await client.connect()
    const handshake = await server.waitForHandshake()

    expect(handshake).toEqual(expect.objectContaining({
      type: 'handshake',
      sessionId: 'session-test',
      adapterVersion: '0.0.1',
      streams: ['redux'],
    }))
    expect(client.isConnected()).toBe(true)

    await client.disconnect()
  })

  it('routes incoming requests to matching handler callback and sends response', async () => {
    server = new MockWsServer()
    await server.start()

    const handlers = createHandlers()
    const client = createWsClient(createConfig(server.url) as never, handlers as never) as {
      connect: () => Promise<void>
      disconnect: () => Promise<void> | void
    }

    await client.connect()
    await server.waitForHandshake()

    const requestId = server.sendRequest('get_snapshot', { stream: 'redux' })
    const response = await server.waitForResponse(requestId)

    expect(handlers.get_snapshot).toHaveBeenCalledWith({ stream: 'redux' })
    expect(response).toEqual(expect.objectContaining({
      type: 'response',
      requestId,
      ok: true,
    }))

    await client.disconnect()
  })

  it('forwards pushed events through send path as push_event messages', async () => {
    server = new MockWsServer()
    await server.start()

    const client = createWsClient(createConfig(server.url) as never, createHandlers() as never) as {
      connect: () => Promise<void>
      disconnect: () => Promise<void> | void
      send: (event: Record<string, unknown>) => void
    }

    await client.connect()
    await server.waitForHandshake()

    client.send({
      stream: 'navigation',
      event: 'route_change',
      timestamp: '2026-01-01T00:00:00.000Z',
      seq: 1,
      sessionId: 'session-test',
      payload: { routeName: 'Home' },
      meta: {
        source: 'adapter',
        adapterVersion: '0.0.1',
        truncated: false,
      },
    })

    const pushEvent = await server.waitForPushEvent()
    expect(pushEvent).toEqual(expect.objectContaining({
      stream: 'navigation',
      event: 'route_change',
      seq: 1,
    }))

    await client.disconnect()
  })

  it('ignores malformed incoming messages without crashing', async () => {
    const rawServer = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    await new Promise<void>((resolve, reject) => {
      rawServer.once('listening', () => resolve())
      rawServer.once('error', error => reject(error))
    })
    const address = rawServer.address()
    if (!address || typeof address === 'string') {
      throw new Error('Failed to bind raw ws server')
    }

    rawServer.on('connection', socket => {
      socket.send('{this is not valid json')
    })

    const client = createWsClient(
      createConfig(`ws://127.0.0.1:${address.port}`) as never,
      createHandlers() as never,
    ) as {
      connect: () => Promise<void>
      disconnect: () => Promise<void> | void
      isConnected: () => boolean
    }

    await expect(client.connect()).resolves.not.toThrow()
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(client.isConnected()).toBe(true)

    await client.disconnect()
    await new Promise<void>((resolve, reject) => {
      rawServer.close(error => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
  })

  it('becomes a no-op client when global WebSocket is unavailable', async () => {
    ;(globalThis as { WebSocket?: typeof WebSocket }).WebSocket = undefined
    server = new MockWsServer()
    await server.start()

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const client = createWsClient(createConfig(server.url) as never, createHandlers() as never) as {
      connect: () => Promise<void>
      disconnect: () => Promise<void> | void
      isConnected: () => boolean
      send: (event: Record<string, unknown>) => void
    }

    await expect(client.connect()).resolves.not.toThrow()
    client.send({
      stream: 'redux',
      event: 'action_dispatched',
      timestamp: '2026-01-01T00:00:00.000Z',
      seq: 1,
      sessionId: 'session-test',
      payload: { actionType: 'noop' },
      meta: { source: 'adapter', adapterVersion: '0.0.1', truncated: false },
    })

    expect(client.isConnected()).toBe(false)
    expect(server.getHandshakes()).toHaveLength(0)
    expect(warnSpy).toHaveBeenCalled()

    await client.disconnect()
  })
})
