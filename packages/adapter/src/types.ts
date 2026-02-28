export interface AdapterConfig {
  serverUrl?: string
}

type StreamName = 'redux' | 'navigation' | 'mmkv'

export interface DebugAdapterHandle {
  captureSnapshot: (stream?: StreamName) => void
  destroy: () => void
  isConnected: () => boolean
}

export interface ReduxStore<
  S extends Record<string, unknown> = Record<string, unknown>,
  A extends { type: string, [key: string]: unknown } = { type: string, [key: string]: unknown },
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
