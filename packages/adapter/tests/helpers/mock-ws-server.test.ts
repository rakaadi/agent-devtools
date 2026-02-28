import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { MockWsServer } from './mock-ws-server.ts'

describe('MockWsServer', () => {
  const clients: WebSocket[] = []
  const servers: MockWsServer[] = []

  afterEach(async () => {
    await Promise.all(clients.map(async client => {
      if (client.readyState === WebSocket.CLOSED) {
        return
      }
      await new Promise<void>(resolve => {
        client.once('close', () => resolve())
        client.close()
      })
    }))
    clients.length = 0

    await Promise.all(servers.map(server => server.stop()))
    servers.length = 0
  })

  it('captures and validates handshake messages', async () => {
    const server = new MockWsServer()
    servers.push(server)
    await server.start()

    const client = new WebSocket(server.url)
    clients.push(client)
    await new Promise<void>((resolve, reject) => {
      client.once('open', () => resolve())
      client.once('error', error => reject(error))
    })

    client.send(JSON.stringify({
      type: 'handshake',
      sessionId: 'session-1',
      adapterVersion: '0.0.1',
      streams: ['redux'],
      deviceInfo: { platform: 'test' },
    }))

    const handshake = await server.waitForHandshake()
    expect(handshake).toEqual(
      expect.objectContaining({
        sessionId: 'session-1',
        streams: ['redux'],
      }),
    )
  })

  it('sends requests and captures matching responses', async () => {
    const server = new MockWsServer()
    servers.push(server)
    await server.start()

    const client = new WebSocket(server.url)
    clients.push(client)
    await new Promise<void>((resolve, reject) => {
      client.once('open', () => resolve())
      client.once('error', error => reject(error))
    })

    client.send(JSON.stringify({
      type: 'handshake',
      sessionId: 'session-2',
      adapterVersion: '0.0.1',
      streams: ['redux'],
    }))
    await server.waitForHandshake()

    client.on('message', payload => {
      const text = typeof payload === 'string' ? payload : payload.toString('utf8')
      const request = JSON.parse(text) as {
        type: string
        requestId: string
      }
      if (request.type !== 'request') {
        return
      }
      client.send(JSON.stringify({
        type: 'response',
        requestId: request.requestId,
        ok: true,
        result: { status: 'ok' },
      }))
    })

    const requestId = server.sendRequest('health_check', { scope: 'adapter' })
    const response = await server.waitForResponse(requestId)
    expect(response.ok).toBe(true)
    expect(response.result).toEqual({ status: 'ok' })
  })

  it('captures push_event payloads', async () => {
    const server = new MockWsServer()
    servers.push(server)
    await server.start()

    const client = new WebSocket(server.url)
    clients.push(client)
    await new Promise<void>((resolve, reject) => {
      client.once('open', () => resolve())
      client.once('error', error => reject(error))
    })

    client.send(JSON.stringify({
      type: 'handshake',
      sessionId: 'session-3',
      adapterVersion: '0.0.1',
      streams: ['navigation'],
    }))
    await server.waitForHandshake()

    client.send(JSON.stringify({
      type: 'push_event',
      event: {
        stream: 'navigation',
        event: 'route_change',
        timestamp: '2026-01-01T00:00:00.000Z',
        seq: 1,
        sessionId: 'session-3',
        payload: {
          routeName: 'Home',
        },
        meta: {
          source: 'adapter',
          adapterVersion: '0.0.1',
          truncated: false,
        },
      },
    }))

    const pushEvent = await server.waitForPushEvent()
    expect(pushEvent.event).toBe('route_change')
    expect(pushEvent.payload).toEqual({ routeName: 'Home' })
  })

  it('waits for the next handshake on repeated calls', async () => {
    const server = new MockWsServer()
    servers.push(server)
    await server.start()

    const client = new WebSocket(server.url)
    clients.push(client)
    await new Promise<void>((resolve, reject) => {
      client.once('open', () => resolve())
      client.once('error', error => reject(error))
    })

    client.send(JSON.stringify({
      type: 'handshake',
      sessionId: 'session-4a',
      adapterVersion: '0.0.1',
      streams: ['redux'],
    }))
    const firstHandshake = await server.waitForHandshake()
    expect(firstHandshake.sessionId).toBe('session-4a')

    const nextHandshakePromise = server.waitForHandshake(200)
    setTimeout(() => {
      client.send(JSON.stringify({
        type: 'handshake',
        sessionId: 'session-4b',
        adapterVersion: '0.0.1',
        streams: ['redux', 'navigation'],
      }))
    }, 20)

    const secondHandshake = await nextHandshakePromise
    expect(secondHandshake.sessionId).toBe('session-4b')
  })

  it('waits for the next push_event on repeated calls', async () => {
    const server = new MockWsServer()
    servers.push(server)
    await server.start()

    const client = new WebSocket(server.url)
    clients.push(client)
    await new Promise<void>((resolve, reject) => {
      client.once('open', () => resolve())
      client.once('error', error => reject(error))
    })

    client.send(JSON.stringify({
      type: 'handshake',
      sessionId: 'session-5',
      adapterVersion: '0.0.1',
      streams: ['navigation'],
    }))
    await server.waitForHandshake()

    client.send(JSON.stringify({
      type: 'push_event',
      event: {
        stream: 'navigation',
        event: 'route_change',
        timestamp: '2026-01-01T00:00:00.000Z',
        seq: 1,
        sessionId: 'session-5',
        payload: {
          routeName: 'Home',
        },
        meta: {
          source: 'adapter',
          adapterVersion: '0.0.1',
          truncated: false,
        },
      },
    }))
    const firstEvent = await server.waitForPushEvent()
    expect(firstEvent.seq).toBe(1)

    const nextEventPromise = server.waitForPushEvent(200)
    setTimeout(() => {
      client.send(JSON.stringify({
        type: 'push_event',
        event: {
          stream: 'navigation',
          event: 'route_change',
          timestamp: '2026-01-01T00:00:01.000Z',
          seq: 2,
          sessionId: 'session-5',
          payload: {
            routeName: 'Settings',
          },
          meta: {
            source: 'adapter',
            adapterVersion: '0.0.1',
            truncated: false,
          },
        },
      }))
    }, 20)

    const secondEvent = await nextEventPromise
    expect(secondEvent.seq).toBe(2)
    expect(secondEvent.payload).toEqual({ routeName: 'Settings' })
  })

  it('ignores malformed and non-JSON messages safely', async () => {
    const server = new MockWsServer()
    servers.push(server)
    await server.start()

    const client = new WebSocket(server.url)
    clients.push(client)
    await new Promise<void>((resolve, reject) => {
      client.once('open', () => resolve())
      client.once('error', error => reject(error))
    })

    client.send('not-json')
    client.send(JSON.stringify({
      type: 'response',
      ok: true,
    }))
    expect(server.getResponses()).toHaveLength(0)

    client.send(JSON.stringify({
      type: 'handshake',
      sessionId: 'session-6',
      adapterVersion: '0.0.1',
      streams: ['mmkv'],
    }))
    const handshake = await server.waitForHandshake()
    expect(handshake.sessionId).toBe('session-6')
  })
})
