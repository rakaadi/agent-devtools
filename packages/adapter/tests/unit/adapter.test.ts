import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initDebugAdapter } from '../../src/adapter.ts'

const mocks = vi.hoisted(() => {
  const createReduxCollector = vi.fn()
  const createNavigationCollector = vi.fn()
  const createMmkvCollector = vi.fn()
  const createWsClient = vi.fn()
  const createRingBuffer = vi.fn()
  const createSnapshotSlot = vi.fn()
  const uuid = vi.fn()

  return {
    createReduxCollector,
    createNavigationCollector,
    createMmkvCollector,
    createWsClient,
    createRingBuffer,
    createSnapshotSlot,
    uuid,
  }
})

vi.mock('../../src/collectors/redux.ts', () => ({
  createReduxCollector: mocks.createReduxCollector,
}))

vi.mock('../../src/collectors/navigation.ts', () => ({
  createNavigationCollector: mocks.createNavigationCollector,
}))

vi.mock('../../src/collectors/mmkv.ts', () => ({
  createMmkvCollector: mocks.createMmkvCollector,
}))

vi.mock('../../src/transport/ws-client.ts', () => ({
  createWsClient: mocks.createWsClient,
}))

vi.mock('../../src/buffer/ring-buffer.ts', () => ({
  createRingBuffer: mocks.createRingBuffer,
  createSnapshotSlot: mocks.createSnapshotSlot,
}))

vi.mock('../../src/utils/uuid.ts', () => ({
  uuid: mocks.uuid,
}))

interface AppState {
  counter: number
}

function createStore(initialState: AppState = { counter: 0 }): {
  getState: () => AppState
  subscribe: (listener: () => void) => () => void
  dispatch: (action: { type: string }) => { type: string }
} {
  let state = initialState
  const listeners = new Set<() => void>()

  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return (): void => {
        listeners.delete(listener)
      }
    },
    dispatch: (action: { type: string }) => {
      if (action.type === 'increment') {
        state = { counter: state.counter + 1 }
      }
      listeners.forEach(listener => listener())
      return action
    },
  }
}

function createNavigationRef(): {
  addListener: (event: 'state', listener: () => void) => () => void
  getCurrentRoute: () => { name: string } | undefined
  getRootState: () => { routes: Array<{ name: string }>, index: number, stale: boolean }
  isReady: () => boolean
} {
  return {
    addListener: () => () => {},
    getCurrentRoute: () => ({ name: 'Home' }),
    getRootState: () => ({ routes: [{ name: 'Home' }], index: 0, stale: false }),
    isReady: () => true,
  }
}

function getCollectorEmitArg(call: unknown[]): ((event: Record<string, unknown>) => void) | undefined {
  return call.find(arg => typeof arg === 'function') as ((event: Record<string, unknown>) => void) | undefined
}

describe('initDebugAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as { __DEV__?: boolean }).__DEV__ = true

    mocks.uuid.mockReturnValue('session-123')

    mocks.createRingBuffer.mockImplementation(() => ({
      push: vi.fn(() => 1),
      query: vi.fn(() => ({ events: [], hasMore: false })),
      latest: vi.fn(),
      stats: vi.fn(() => ({ count: 0, oldestSeq: 0, latestSeq: 0, capacity: 200 })),
      clear: vi.fn(),
    }))

    mocks.createSnapshotSlot.mockImplementation(() => ({
      get: vi.fn(),
      set: vi.fn(),
      clear: vi.fn(),
    }))

    mocks.createReduxCollector.mockImplementation(() => ({
      middleware: vi.fn(),
      captureSnapshot: vi.fn(),
      destroy: vi.fn(),
    }))

    mocks.createNavigationCollector.mockImplementation(() => ({
      captureSnapshot: vi.fn(),
      destroy: vi.fn(),
    }))

    mocks.createMmkvCollector.mockImplementation(() => ({
      captureSnapshot: vi.fn(),
      destroy: vi.fn(),
    }))

    mocks.createWsClient.mockImplementation(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      send: vi.fn(),
      isConnected: vi.fn(() => true),
    }))
  })

  it('returns a no-op handle and skips initialization when __DEV__ is false', () => {
    ;(globalThis as { __DEV__?: boolean }).__DEV__ = false

    const adapter = initDebugAdapter({
      store: createStore(),
      navigationRef: createNavigationRef(),
    })

    expect(adapter.isConnected()).toBe(false)
    expect(() => adapter.captureSnapshot('redux')).not.toThrow()
    expect(() => adapter.destroy()).not.toThrow()

    expect(mocks.createReduxCollector).not.toHaveBeenCalled()
    expect(mocks.createNavigationCollector).not.toHaveBeenCalled()
    expect(mocks.createWsClient).not.toHaveBeenCalled()
  })

  it('generates a session ID once during init and passes it to transport configuration', () => {
    initDebugAdapter({ store: createStore() })

    expect(mocks.uuid).toHaveBeenCalledTimes(1)
    expect(mocks.createWsClient).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-123',
      }),
      expect.any(Object),
    )
  })

  it('throws when config values are invalid', () => {
    expect(() => initDebugAdapter({
      store: createStore(),
      config: { serverUrl: 'http://localhost:19850' },
    })).toThrow(/wss?:\/\//)
  })

  it('initializes collectors for each valid provided data source', () => {
    const store = createStore()
    const navigationRef = createNavigationRef()

    initDebugAdapter({
      store,
      navigationRef,
      mmkvInstances: {
        cache: {
          set: () => {},
          delete: () => {},
          getAllKeys: () => [],
        },
      },
    })

    expect(mocks.createReduxCollector).toHaveBeenCalledTimes(1)
    expect(mocks.createNavigationCollector).toHaveBeenCalledTimes(1)
    expect(mocks.createMmkvCollector).toHaveBeenCalledTimes(1)
  })

  it('normalizes collector raw events into debug envelopes before buffering and transport send', () => {
    const ringBufferPush = vi.fn(() => 1)
    mocks.createRingBuffer.mockImplementation(() => ({
      push: ringBufferPush,
      query: vi.fn(() => ({ events: [], hasMore: false })),
      latest: vi.fn(),
      stats: vi.fn(() => ({ count: 0, oldestSeq: 0, latestSeq: 0, capacity: 200 })),
      clear: vi.fn(),
    }))

    const wsSend = vi.fn()
    mocks.createWsClient.mockImplementation(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      send: wsSend,
      isConnected: vi.fn(() => true),
    }))

    initDebugAdapter({ store: createStore() })

    const emit = getCollectorEmitArg(mocks.createReduxCollector.mock.calls[0])
    if (!emit) {
      throw new Error('Redux collector emit callback was not provided')
    }

    emit({ type: 'action_dispatched', actionType: 'increment' })

    expect(ringBufferPush).toHaveBeenCalledWith(
      expect.objectContaining({
        stream: 'redux',
        event: 'action_dispatched',
        sessionId: 'session-123',
        timestamp: expect.any(String),
        payload: { actionType: 'increment' },
        meta: expect.objectContaining({
          truncated: false,
        }),
      }),
    )

    expect(wsSend).toHaveBeenCalled()
  })

  it('registers request routing hooks for get_snapshot and query_events', async () => {
    initDebugAdapter({ store: createStore() })

    const handlers = mocks.createWsClient.mock.calls[0]?.[1] as
      | {
        get_snapshot?: (params?: Record<string, unknown>) => Promise<unknown>
        query_events?: (params?: Record<string, unknown>) => Promise<unknown>
      }
      | undefined

    expect(handlers).toEqual(expect.objectContaining({
      get_snapshot: expect.any(Function),
      query_events: expect.any(Function),
    }))

    await expect(handlers?.get_snapshot?.({ stream: 'redux' })).resolves.not.toThrow()
    await expect(
      handlers?.query_events?.({ stream: 'redux', sinceSeq: 0, limit: 50 }),
    ).resolves.not.toThrow()
  })

  it('destroys previous instance before creating a new one on double init', () => {
    const firstCollectorDestroy = vi.fn()
    const secondCollectorDestroy = vi.fn()

    mocks.createReduxCollector
      .mockImplementationOnce(() => ({
        middleware: vi.fn(),
        captureSnapshot: vi.fn(),
        destroy: firstCollectorDestroy,
      }))
      .mockImplementationOnce(() => ({
        middleware: vi.fn(),
        captureSnapshot: vi.fn(),
        destroy: secondCollectorDestroy,
      }))

    const firstDisconnect = vi.fn()
    const secondDisconnect = vi.fn()

    mocks.createWsClient
      .mockImplementationOnce(() => ({
        connect: vi.fn(),
        disconnect: firstDisconnect,
        send: vi.fn(),
        isConnected: vi.fn(() => true),
      }))
      .mockImplementationOnce(() => ({
        connect: vi.fn(),
        disconnect: secondDisconnect,
        send: vi.fn(),
        isConnected: vi.fn(() => true),
      }))

    const first = initDebugAdapter({ store: createStore() })
    const second = initDebugAdapter({ store: createStore() })

    expect(firstCollectorDestroy).toHaveBeenCalledTimes(1)
    expect(firstDisconnect).toHaveBeenCalledTimes(1)
    expect(secondCollectorDestroy).not.toHaveBeenCalled()
    expect(secondDisconnect).not.toHaveBeenCalled()
    expect(second).not.toBe(first)
  })

  it('cleans up collectors and transport on destroy', () => {
    const reduxDestroy = vi.fn()
    const navigationDestroy = vi.fn()
    const wsDisconnect = vi.fn()

    mocks.createReduxCollector.mockImplementation(() => ({
      middleware: vi.fn(),
      captureSnapshot: vi.fn(),
      destroy: reduxDestroy,
    }))

    mocks.createNavigationCollector.mockImplementation(() => ({
      captureSnapshot: vi.fn(),
      destroy: navigationDestroy,
    }))

    mocks.createWsClient.mockImplementation(() => ({
      connect: vi.fn(),
      disconnect: wsDisconnect,
      send: vi.fn(),
      isConnected: vi.fn(() => true),
    }))

    const adapter = initDebugAdapter({
      store: createStore(),
      navigationRef: createNavigationRef(),
    })

    adapter.destroy()

    expect(reduxDestroy).toHaveBeenCalledTimes(1)
    expect(navigationDestroy).toHaveBeenCalledTimes(1)
    expect(wsDisconnect).toHaveBeenCalledTimes(1)
  })
})
