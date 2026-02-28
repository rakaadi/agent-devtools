export interface NavigationCollectorEvent {
  type: 'route_change' | 'navigation_snapshot'
  [key: string]: unknown
}

interface NavigationRef {
  addListener: (event: 'state', listener: () => void) => () => void
  getCurrentRoute: () => { name: string, params?: Record<string, unknown> } | undefined
  getRootState: () => { routes: Array<{ name: string, params?: Record<string, unknown> }>, index: number, stale: boolean }
  isReady: () => boolean
}

export function createNavigationCollector(
  navigationRef: NavigationRef,
  emit: (event: NavigationCollectorEvent) => void,
): {
  captureSnapshot: () => void
  destroy: () => void
} {
  let active = true
  let unsubscribe: (() => void) | null = null
  let readinessInterval: ReturnType<typeof setInterval> | null = null

  const maybeEmit = (event: NavigationCollectorEvent): void => {
    if (!active) {
      return
    }

    emit(event)
  }

  const emitRouteChange = (): void => {
    if (!navigationRef.isReady()) {
      return
    }

    const route = navigationRef.getCurrentRoute()
    const rootState = navigationRef.getRootState()
    maybeEmit({
      type: 'route_change',
      routeName: route?.name ?? 'unknown',
      params: route?.params ?? null,
      navigationType: 'unknown',
      stackDepth: rootState.routes.length,
    })
  }

  const subscribeToState = (): void => {
    if (!active || unsubscribe) {
      return
    }

    unsubscribe = navigationRef.addListener('state', emitRouteChange)
  }

  if (navigationRef.isReady()) {
    subscribeToState()
  } else {
    readinessInterval = setInterval(() => {
      if (!active || !navigationRef.isReady()) {
        return
      }

      if (readinessInterval) {
        clearInterval(readinessInterval)
        readinessInterval = null
      }
      subscribeToState()
    }, 50)
  }

  const captureSnapshot = (): void => {
    const state = navigationRef.getRootState()
    maybeEmit({
      type: 'navigation_snapshot',
      routes: state.routes,
      index: state.index,
      stale: state.stale,
    })
  }

  const destroy = (): void => {
    active = false
    if (readinessInterval) {
      clearInterval(readinessInterval)
      readinessInterval = null
    }
    if (unsubscribe) {
      unsubscribe()
      unsubscribe = null
    }
  }

  return {
    captureSnapshot,
    destroy,
  }
}
