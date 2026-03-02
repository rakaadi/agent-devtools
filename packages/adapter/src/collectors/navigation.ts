import type { NavigationContainerRef } from '../types.ts'

export interface NavigationCollectorEvent {
  type: 'route_change' | 'navigation_snapshot'
  [key: string]: unknown
}

export function createNavigationCollector(
  navigationRef: NavigationContainerRef,
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

    try {
      const route = navigationRef.getCurrentRoute()
      const rootState = navigationRef.getRootState()
      maybeEmit({
        type: 'route_change',
        routeName: route?.name ?? 'unknown',
        params: route?.params ?? null,
        navigationType: 'unknown',
        stackDepth: rootState.routes.length,
      })
    } catch (error) {
      console.warn('Navigation collector failed to emit route change', error)
    }
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
    if (!active) {
      return
    }

    try {
      const state = navigationRef.getRootState()
      maybeEmit({
        type: 'navigation_snapshot',
        routes: state.routes,
        index: state.index,
        stale: state.stale,
      })
    } catch (error) {
      console.warn('Navigation collector failed to capture snapshot', error)
    }
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
