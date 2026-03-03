import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { initDebugAdapter } from '../../src/adapter.ts'
import { createMockNavigationRef } from '../helpers/mock-navigation-ref.ts'
import { MockWsServer } from '../helpers/mock-ws-server.ts'

describe('adapter to server roundtrip', () => {
  let server: MockWsServer | null = null
  const originalWebSocket = globalThis.WebSocket

  beforeEach(async () => {
    ;(globalThis as { __DEV__?: boolean }).__DEV__ = true
    ;(globalThis as { WebSocket?: typeof WebSocket }).WebSocket = WebSocket as unknown as typeof globalThis.WebSocket

    server = new MockWsServer()
    await server.start()
  })

  afterEach(async () => {
    await server?.stop()
    server = null
    ;(globalThis as { WebSocket?: typeof originalWebSocket }).WebSocket = originalWebSocket
  })

  it('connects, pushes route events, and responds to snapshot requests', async () => {
    if (!server) {
      throw new Error('Mock server not initialized')
    }

    const navigationRef = createMockNavigationRef({
      ready: true,
      currentRoute: { name: 'Home' },
      rootState: {
        routes: [{ name: 'Home' }],
        index: 0,
        stale: false,
      },
    })

    const adapter = initDebugAdapter({
      navigationRef,
      config: { serverUrl: server.url },
    })

    const handshake = await server.waitForHandshake()
    expect(handshake).toEqual(expect.objectContaining({
      type: 'handshake',
      streams: ['navigation'],
    }))

    navigationRef.setCurrentRoute({ name: 'Details', params: { id: '42' } })
    navigationRef.setRootState({
      routes: [{ name: 'Home' }, { name: 'Details', params: { id: '42' } }],
      index: 1,
      stale: false,
    })
    navigationRef.emitState()

    const routeChange = await server.waitForPushEvent()
    expect(routeChange).toEqual(expect.objectContaining({
      stream: 'navigation',
      event: 'route_change',
      payload: expect.objectContaining({
        routeName: 'Details',
      }),
    }))

    const requestId = server.sendRequest('get_snapshot', { stream: 'navigation' })
    const response = await server.waitForResponse(requestId)

    expect(response).toEqual(expect.objectContaining({
      type: 'response',
      requestId,
      ok: true,
      result: expect.objectContaining({
        stream: 'navigation',
        event: 'navigation_snapshot',
      }),
    }))

    const queryRequestId = server.sendRequest('query_events', { stream: 'navigation', sinceSeq: 0, limit: 10 })
    const queryResponse = await server.waitForResponse(queryRequestId)

    expect(queryResponse).toEqual(expect.objectContaining({
      type: 'response',
      requestId: queryRequestId,
      ok: true,
      result: expect.objectContaining({
        events: expect.any(Array),
      }),
    }))

    expect(() => adapter.destroy()).not.toThrow()
  })
})
