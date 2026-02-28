export interface MockAction {
  type: string
  meta?: Record<string, unknown>
  [key: string]: unknown
}

export type MockDispatch<A extends MockAction> = (action: A) => A
export type MockListener = () => void

export interface MockMiddlewareApi<S, A extends MockAction> {
  getState: () => S
  dispatch: MockDispatch<A>
}

export type MockMiddleware<S, A extends MockAction> = (
  api: MockMiddlewareApi<S, A>,
) => (next: MockDispatch<A>) => MockDispatch<A>

export interface MockStore<S, A extends MockAction> {
  getState: () => S
  subscribe: (listener: MockListener) => () => void
  dispatch: MockDispatch<A>
}

export interface CreateMockStoreOptions<S, A extends MockAction> {
  initialState: S
  reducer?: (state: S, action: A) => S
  middlewares?: MockMiddleware<S, A>[]
}

export function createMockStore<S, A extends MockAction>(
  options: CreateMockStoreOptions<S, A>,
): MockStore<S, A> {
  const {
    initialState,
    reducer = state => state,
    middlewares = [],
  } = options

  let state = initialState
  const listeners = new Set<MockListener>()

  const getState = (): S => state

  const subscribe = (listener: MockListener): (() => void) => {
    listeners.add(listener)
    return (): void => {
      listeners.delete(listener)
    }
  }

  const baseDispatch: MockDispatch<A> = (action: A): A => {
    state = reducer(state, action)
    for (const listener of listeners) {
      listener()
    }
    return action
  }

  let dispatch: MockDispatch<A> = baseDispatch
  if (middlewares.length > 0) {
    const api: MockMiddlewareApi<S, A> = {
      getState,
      dispatch: (action: A): A => dispatch(action),
    }
    const chain = middlewares.map(middleware => middleware(api))
    dispatch = chain.reduceRight((next, middleware) => middleware(next), baseDispatch)
  }

  return {
    getState,
    subscribe,
    dispatch: (action: A): A => dispatch(action),
  }
}
