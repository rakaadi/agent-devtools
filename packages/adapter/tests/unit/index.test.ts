import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const initDebugAdapterCore = vi.fn()
  const createNoopHandle = vi.fn()
  const createReduxCollector = vi.fn()

  return {
    initDebugAdapterCore,
    createNoopHandle,
    createReduxCollector,
  }
})

vi.mock('../../src/adapter.ts', () => ({
  initDebugAdapter: mocks.initDebugAdapterCore,
  createNoopHandle: mocks.createNoopHandle,
}))

vi.mock('../../src/collectors/redux.ts', () => ({
  createReduxCollector: mocks.createReduxCollector,
}))

describe('adapter public index', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as { __DEV__?: boolean }).__DEV__ = true
    delete (globalThis as { useEffect?: unknown }).useEffect
    delete (globalThis as { React?: { useEffect?: unknown } }).React

    mocks.createNoopHandle.mockReturnValue({
      captureSnapshot: vi.fn(),
      destroy: vi.fn(),
      isConnected: vi.fn(() => false),
    })
    mocks.initDebugAdapterCore.mockReturnValue({
      captureSnapshot: vi.fn(),
      destroy: vi.fn(),
      isConnected: vi.fn(() => true),
    })
  })

  it('initDebugAdapter delegates to core initializer in dev mode and returns noop in production mode', async () => {
    const index = await import('../../src/index.ts')

    const options = { store: { getState: () => ({}), subscribe: () => () => {}, dispatch: (a: { type: string }) => a } }
    const devHandle = index.initDebugAdapter(options)
    expect(mocks.initDebugAdapterCore).toHaveBeenCalledWith(options)
    expect(devHandle.isConnected()).toBe(true)

    ;(globalThis as { __DEV__?: boolean }).__DEV__ = false
    const prodHandle = index.initDebugAdapter(options)
    expect(mocks.createNoopHandle).toHaveBeenCalledTimes(1)
    expect(prodHandle.isConnected()).toBe(false)
  })

  it('useDebugAdapter runs init immediately when useEffect is unavailable', async () => {
    const index = await import('../../src/index.ts')
    const options = { store: { getState: () => ({}), subscribe: () => () => {}, dispatch: (a: { type: string }) => a } }

    index.useDebugAdapter(options)

    expect(mocks.initDebugAdapterCore).toHaveBeenCalledWith(options)
  })

  it('useDebugAdapter registers cleanup through resolved useEffect', async () => {
    const cleanup = vi.fn()
    const handle = {
      captureSnapshot: vi.fn(),
      destroy: cleanup,
      isConnected: vi.fn(() => true),
    }
    mocks.initDebugAdapterCore.mockReturnValue(handle)

    let capturedEffect: (() => void | (() => void)) | undefined
    ;(globalThis as { React?: { useEffect?: (effect: () => void | (() => void), deps: unknown[]) => void } }).React = {
      useEffect: effect => {
        capturedEffect = effect
      },
    }

    const index = await import('../../src/index.ts')
    const options = {
      navigationRef: {
        isReady: () => true,
        addListener: () => () => {},
        getCurrentRoute: () => undefined,
        getRootState: () => ({ routes: [], index: 0, stale: false }),
      },
    }

    index.useDebugAdapter(options)
    expect(capturedEffect).toBeTypeOf('function')

    const disposer = capturedEffect?.()
    expect(disposer).toBeTypeOf('function')
    disposer?.()
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('createDebugMiddleware returns passthrough middleware in production mode', async () => {
    ;(globalThis as { __DEV__?: boolean }).__DEV__ = false
    const index = await import('../../src/index.ts')

    const middleware = index.createDebugMiddleware()
    const next = vi.fn((action: { type: string }) => action)
    const dispatch = middleware({
      getState: () => ({}),
      dispatch: (action: { type: string }) => action,
    })(next)

    const action = { type: 'noop' }
    expect(dispatch(action)).toBe(action)
    expect(next).toHaveBeenCalledWith(action)
  })

  it('createDebugMiddleware marks api with attachment symbol and delegates to redux collector middleware', async () => {
    const collectorMiddleware = vi.fn((_api: Record<PropertyKey, unknown>) => next => action => next(action))
    mocks.createReduxCollector.mockReturnValue({
      middleware: collectorMiddleware,
      captureSnapshot: vi.fn(),
      destroy: vi.fn(),
    })

    const index = await import('../../src/index.ts')
    const middleware = index.createDebugMiddleware()

    const api: {
      getState: () => Record<string, unknown>
      dispatch: (action: { type: string }) => { type: string }
      [key: symbol]: unknown
    } = {
      getState: () => ({}),
      dispatch: (action: { type: string }) => action,
    }
    const next = vi.fn((action: { type: string }) => action)

    const dispatch = middleware(api)(next)
    const action = { type: 'ready' }
    dispatch(action)

    expect(mocks.createReduxCollector).toHaveBeenCalledWith(expect.any(Function))
    expect(collectorMiddleware).toHaveBeenCalledWith(api)
    expect(api[Symbol.for('agent-devtools:middleware-attached')]).toBe(true)
    expect(next).toHaveBeenCalledWith(action)
  })
})
