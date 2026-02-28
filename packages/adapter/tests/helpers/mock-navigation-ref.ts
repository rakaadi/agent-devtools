export interface MockNavigationRoute {
  name: string
  params?: Record<string, unknown>
}

export interface MockNavigationState {
  routes: MockNavigationRoute[]
  index: number
  stale: boolean
}

type StateListener = () => void

export interface MockNavigationRef {
  addListener: (event: 'state', listener: StateListener) => () => void
  getCurrentRoute: () => MockNavigationRoute | undefined
  getRootState: () => MockNavigationState
  isReady: () => boolean
  setReady: (ready: boolean) => void
  setCurrentRoute: (route: MockNavigationRoute | undefined) => void
  setRootState: (state: MockNavigationState) => void
  emitState: () => void
}

export function createMockNavigationRef(options?: {
  ready?: boolean
  currentRoute?: MockNavigationRoute
  rootState?: MockNavigationState
}): MockNavigationRef {
  let ready = options?.ready ?? true
  let currentRoute = options?.currentRoute
  let rootState: MockNavigationState = options?.rootState ?? {
    routes: currentRoute ? [currentRoute] : [],
    index: 0,
    stale: false,
  }
  const stateListeners = new Set<StateListener>()

  const addListener = (event: 'state', listener: StateListener): (() => void) => {
    if (event !== 'state') {
      return (): void => {}
    }

    stateListeners.add(listener)
    return (): void => {
      stateListeners.delete(listener)
    }
  }

  const emitState = (): void => {
    for (const listener of stateListeners) {
      listener()
    }
  }

  return {
    addListener,
    getCurrentRoute: (): MockNavigationRoute | undefined => currentRoute,
    getRootState: (): MockNavigationState => rootState,
    isReady: (): boolean => ready,
    setReady: (value: boolean): void => {
      ready = value
    },
    setCurrentRoute: (route: MockNavigationRoute | undefined): void => {
      currentRoute = route
    },
    setRootState: (state: MockNavigationState): void => {
      rootState = state
    },
    emitState,
  }
}
