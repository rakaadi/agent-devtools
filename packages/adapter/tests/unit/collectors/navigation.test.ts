import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMockNavigationRef } from '../../helpers/mock-navigation-ref.ts'
import { createNavigationCollector } from '../../../src/collectors/navigation.ts'

describe('createNavigationCollector', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns collector API', () => {
    const navigationRef = createMockNavigationRef()
    const collector = createNavigationCollector(navigationRef, vi.fn())

    expect(collector).toEqual({
      captureSnapshot: expect.any(Function),
      destroy: expect.any(Function),
    })

    collector.destroy()
  })

  it('emits route_change with routeName, params, type and stackDepth', () => {
    const emit = vi.fn()
    const navigationRef = createMockNavigationRef({
      ready: true,
      currentRoute: { name: 'Home', params: { tab: 'feed' } },
      rootState: {
        routes: [{ name: 'Home', params: { tab: 'feed' } }],
        index: 0,
        stale: false,
      },
    })

    const collector = createNavigationCollector(navigationRef, emit)
    navigationRef.setCurrentRoute({ name: 'Profile', params: { userId: 'u-1' } })
    navigationRef.setRootState({
      routes: [
        { name: 'Home' },
        { name: 'Profile', params: { userId: 'u-1' } },
      ],
      index: 1,
      stale: false,
    })
    navigationRef.emitState()

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'route_change',
        routeName: 'Profile',
        params: { userId: 'u-1' },
        stackDepth: 2,
      }),
    )

    collector.destroy()
  })

  it('falls back to unknown routeName and null params when current route is undefined', () => {
    const emit = vi.fn()
    const navigationRef = createMockNavigationRef({
      ready: true,
      rootState: {
        routes: [{ name: 'Boot' }],
        index: 0,
        stale: false,
      },
    })

    const collector = createNavigationCollector(navigationRef, emit)
    navigationRef.emitState()

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'route_change',
        routeName: 'unknown',
        params: null,
        stackDepth: 1,
      }),
    )

    collector.destroy()
  })

  it('captureSnapshot emits full navigation snapshot payload', () => {
    const emit = vi.fn()
    const navigationRef = createMockNavigationRef({
      ready: true,
      currentRoute: { name: 'Home' },
      rootState: {
        routes: [{ name: 'Home' }],
        index: 0,
        stale: false,
      },
    })
    const collector = createNavigationCollector(navigationRef, emit)

    navigationRef.setRootState({
      routes: [
        { name: 'Home' },
        { name: 'Profile', params: { userId: 'u-1' } },
      ],
      index: 1,
      stale: true,
    })
    collector.captureSnapshot()

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'navigation_snapshot',
        routes: [
          { name: 'Home' },
          { name: 'Profile', params: { userId: 'u-1' } },
        ],
        index: 1,
        stale: true,
      }),
    )

    collector.destroy()
  })

  it('defers subscription until navigation ref is ready and emits after readiness', () => {
    vi.useFakeTimers()
    const emit = vi.fn()
    const navigationRef = createMockNavigationRef({
      ready: false,
      currentRoute: { name: 'Auth' },
      rootState: {
        routes: [{ name: 'Auth' }],
        index: 0,
        stale: false,
      },
    })
    const addListenerSpy = vi.spyOn(navigationRef, 'addListener')

    const collector = createNavigationCollector(navigationRef, emit)

    expect(addListenerSpy).not.toHaveBeenCalled()
    navigationRef.emitState()
    expect(emit).not.toHaveBeenCalled()

    navigationRef.setReady(true)
    vi.advanceTimersByTime(100)
    expect(addListenerSpy).toHaveBeenCalledWith('state', expect.any(Function))

    navigationRef.emitState()
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'route_change',
        routeName: 'Auth',
        params: null,
        stackDepth: 1,
      }),
    )

    collector.destroy()
  })

  it('destroy unsubscribes and prevents further emissions', () => {
    const emit = vi.fn()
    const navigationRef = createMockNavigationRef({
      ready: true,
      currentRoute: { name: 'Home', params: { tab: 'feed' } },
      rootState: {
        routes: [{ name: 'Home', params: { tab: 'feed' } }],
        index: 0,
        stale: false,
      },
    })

    const originalAddListener = navigationRef.addListener
    const unsubscribeSpy = vi.fn()
    vi.spyOn(navigationRef, 'addListener').mockImplementation((event, listener) => {
      const originalUnsubscribe = originalAddListener(event, listener)
      return (): void => {
        unsubscribeSpy()
        originalUnsubscribe()
      }
    })

    const collector = createNavigationCollector(navigationRef, emit)
    navigationRef.emitState()
    const callsBeforeDestroy = emit.mock.calls.length

    collector.destroy()
    expect(unsubscribeSpy).toHaveBeenCalledTimes(1)

    navigationRef.emitState()
    collector.captureSnapshot()
    expect(emit).toHaveBeenCalledTimes(callsBeforeDestroy)
  })
})
