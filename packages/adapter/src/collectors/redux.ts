import type { ActionLike, Middleware } from '../types.ts'
import { sizeof } from '../utils/sizeof.ts'

export interface ReduxCollectorEvent {
  type: 'action_dispatched' | 'state_snapshot' | 'state_diff'
  [key: string]: unknown
}

export function createReduxCollector<S extends Record<string, unknown>, A extends ActionLike>(
  emit: (event: ReduxCollectorEvent) => void,
): {
  middleware: Middleware<S, A>
  captureSnapshot: () => void
  destroy: () => void
} {
  let active = true
  let getState: (() => S) | null = null

  const maybeEmit = (event: ReduxCollectorEvent): void => {
    if (!active) {
      return
    }
    emit(event)
  }

  const middleware: Middleware<S, A> = api => {
    getState = api.getState

    return next => action => {
      let beforeState: S | null = null
      try {
        beforeState = api.getState()
      } catch (error) {
        console.warn('Redux collector failed to read state before dispatch', error)
      }

      const result = next(action)

      try {
        maybeEmit({
          type: 'action_dispatched',
          actionType: action.type,
          ...(action.meta !== undefined
            ? { meta: action.meta as Record<string, unknown> }
            : {}),
        })

        const afterState = api.getState()

        if (beforeState && afterState) {
          const keys = new Set([
            ...Object.keys(beforeState),
            ...Object.keys(afterState),
          ])
          for (const key of keys) {
            if (beforeState[key] !== afterState[key]) {
              maybeEmit({
                type: 'state_diff',
                path: key,
                prev: beforeState[key],
                next: afterState[key],
              })
            }
          }
        }
      } catch (error) {
        console.warn('Redux collector failed to process dispatched action', error)
      }

      return result
    }
  }

  const captureSnapshot = (): void => {
    if (!getState) {
      return
    }

    try {
      const state = getState()
      maybeEmit({
        type: 'state_snapshot',
        state,
        stateSize: sizeof(state),
      })
    } catch (error) {
      console.warn('Redux collector failed to capture snapshot', error)
    }
  }

  const destroy = (): void => {
    active = false
  }

  return {
    middleware,
    captureSnapshot,
    destroy,
  }
}
