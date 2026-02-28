import { describe, expect, it, vi } from 'vitest'
import {
  createMockStore,
  type MockAction,
  type MockMiddleware,
} from '../../helpers/mock-store.ts'
import { createReduxCollector } from '../../../src/collectors/redux.ts'

interface AppState {
  counter: { value: number }
  session: { userId: string | null }
}

interface AppAction extends MockAction {
  type: 'counter/increment' | 'session/login' | 'noop'
  meta?: Record<string, unknown>
}

describe('createReduxCollector', () => {
  it('returns middleware API shape', () => {
    const emit = vi.fn()
    const collector = createReduxCollector(emit)
    expect(collector).toEqual({
      middleware: expect.any(Function),
      captureSnapshot: expect.any(Function),
      destroy: expect.any(Function),
    })
  })

  it('emits action_dispatched after next(action) with explicit action type and optional meta only', () => {
    const emittedEvents: Array<Record<string, unknown>> = []
    let stateAtActionEmit = -1
    const emit = vi.fn((event: Record<string, unknown>) => {
      emittedEvents.push(event)
      if (event.type === 'action_dispatched') {
        stateAtActionEmit = store.getState().counter.value
      }
    })
    const store = createMockStore<AppState, AppAction>({
      initialState: {
        counter: { value: 0 },
        session: { userId: null },
      },
      reducer: (state, action) => action.type === 'counter/increment'
        ? {
          ...state,
          counter: { value: state.counter.value + 1 },
        }
        : state,
      middlewares: [createReduxCollector(emit).middleware as MockMiddleware<AppState, AppAction>],
    })

    store.dispatch({
      type: 'counter/increment',
      meta: { source: 'button' },
      payload: { secret: true },
    })
    store.dispatch({ type: 'noop', payload: { ignored: true } })

    expect(stateAtActionEmit).toBe(1)

    const [firstDispatchedEvent, secondDispatchedEvent] = emittedEvents.filter(
      event => event.type === 'action_dispatched',
    )

    expect(firstDispatchedEvent).toEqual({
      type: 'action_dispatched',
      actionType: 'counter/increment',
      meta: { source: 'button' },
    })
    expect(firstDispatchedEvent).not.toHaveProperty('payload')

    expect(secondDispatchedEvent).toEqual({
      type: 'action_dispatched',
      actionType: 'noop',
    })
    expect(secondDispatchedEvent).not.toHaveProperty('meta')
    expect(secondDispatchedEvent).not.toHaveProperty('payload')
  })

  it('emits state_snapshot with state and stateSize', () => {
    const emittedEvents: Array<Record<string, unknown>> = []
    const emit = vi.fn((event: Record<string, unknown>) => {
      emittedEvents.push(event)
    })
    const collector = createReduxCollector(emit)

    const store = createMockStore<AppState, AppAction>({
      initialState: {
        counter: { value: 0 },
        session: { userId: null },
      },
      reducer: (state, action) => action.type === 'counter/increment'
        ? {
          ...state,
          counter: { value: state.counter.value + 1 },
        }
        : state,
      middlewares: [collector.middleware as MockMiddleware<AppState, AppAction>],
    })

    store.dispatch({ type: 'counter/increment' })
    collector.captureSnapshot()

    const snapshotEvent = emittedEvents.find(event => event.type === 'state_snapshot')
    expect(snapshotEvent).toEqual(
      expect.objectContaining({
        state: expect.objectContaining({ counter: { value: 1 } }),
        stateSize: expect.any(Number),
      }),
    )
  })

  it('emits state_diff for each changed top-level slice with path, prev, and next', () => {
    const emittedEvents: Array<Record<string, unknown>> = []
    const emit = vi.fn((event: Record<string, unknown>) => {
      emittedEvents.push(event)
    })
    const collector = createReduxCollector(emit)

    const store = createMockStore<AppState, AppAction>({
      initialState: {
        counter: { value: 0 },
        session: { userId: null },
      },
      reducer: (state, action) => {
        if (action.type !== 'session/login') {
          return state
        }

        return {
          counter: { value: state.counter.value + 1 },
          session: { userId: 'u-1' },
        }
      },
      middlewares: [collector.middleware as MockMiddleware<AppState, AppAction>],
    })

    store.dispatch({ type: 'session/login' })

    const diffEvents = emittedEvents.filter(event => event.type === 'state_diff')
    expect(diffEvents).toHaveLength(2)
    expect(diffEvents).toEqual(
      expect.arrayContaining([
        {
          type: 'state_diff',
          path: 'counter',
          prev: { value: 0 },
          next: { value: 1 },
        },
        {
          type: 'state_diff',
          path: 'session',
          prev: { userId: null },
          next: { userId: 'u-1' },
        },
      ]),
    )
  })

  it('does not crash dispatch when getState throws and logs the failure', () => {
    const emit = vi.fn()
    const collector = createReduxCollector<AppState, AppAction>(emit)
    const next = vi.fn((action: AppAction) => action)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const dispatch = collector.middleware({
      getState: () => {
        throw new Error('boom')
      },
      dispatch: (action: AppAction) => action,
    })(next)

    expect(() => dispatch({ type: 'noop' })).not.toThrow()
    expect(next).toHaveBeenCalledWith({ type: 'noop' })
    expect(emit).toHaveBeenCalledWith({
      type: 'action_dispatched',
      actionType: 'noop',
    })
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('disables future emissions after destroy', () => {
    const emittedEvents: Array<Record<string, unknown>> = []
    const emit = vi.fn((event: Record<string, unknown>) => {
      emittedEvents.push(event)
    })
    const collector = createReduxCollector(emit)
    const store = createMockStore<AppState, AppAction>({
      initialState: {
        counter: { value: 0 },
        session: { userId: null },
      },
      reducer: (state, action) => action.type === 'counter/increment'
        ? {
          ...state,
          counter: { value: state.counter.value + 1 },
        }
        : state,
      middlewares: [collector.middleware as MockMiddleware<AppState, AppAction>],
    })

    store.dispatch({ type: 'counter/increment' })
    const emittedBeforeDestroy = emittedEvents.length

    collector.destroy()
    store.dispatch({ type: 'counter/increment' })
    collector.captureSnapshot()

    expect(emittedEvents).toHaveLength(emittedBeforeDestroy)
  })
})
