import type { StreamName } from '@agent-devtools/shared'
import type { MmkvInstance } from './collectors/mmkv.ts'

export interface ActionLike {
  type: string
  [key: string]: unknown
}

export interface MiddlewareApi<S, A extends ActionLike> {
  getState: () => S
  dispatch: (action: A) => A
}

export type Middleware<S, A extends ActionLike> = (
  api: MiddlewareApi<S, A>,
) => (next: (action: A) => A) => (action: A) => A

export interface AdapterConfig {
  serverUrl?: string
}

export interface DebugAdapterHandle {
  captureSnapshot: (stream?: StreamName) => void
  destroy: () => void
  isConnected: () => boolean
}

export interface ReduxStore<
  S extends Record<string, unknown> = Record<string, unknown>,
  A extends ActionLike = ActionLike,
> extends Record<string, unknown> {
  getState: () => S
  subscribe: (listener: () => void) => () => void
  dispatch: (action: A) => A
}

export interface NavigationContainerRef {
  addListener: (event: 'state', listener: () => void) => () => void
  getCurrentRoute: () => { name: string, params?: Record<string, unknown> } | undefined
  getRootState: () => {
    routes: Array<{ name: string, params?: Record<string, unknown> }>
    index: number
    stale: boolean
  }
  isReady: () => boolean
}

export interface InitDebugAdapterOptions {
  store?: ReduxStore
  navigationRef?: NavigationContainerRef
  mmkvInstances?: Record<string, MmkvInstance>
  config?: AdapterConfig
}
