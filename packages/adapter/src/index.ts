import { initDebugAdapter as initDebugAdapterCore, createNoopHandle } from './adapter.ts'
import { createReduxCollector } from './collectors/redux.ts'
import type { ActionLike, DebugAdapterHandle, InitDebugAdapterOptions, Middleware } from './types.ts'

type DebugMiddleware = Middleware<Record<string, unknown>, ActionLike>

type UseEffectLike = (effect: () => void | (() => void), deps: unknown[]) => void

const MIDDLEWARE_ATTACHED_SYMBOL = Symbol.for('agent-devtools:middleware-attached')

function isDevEnabled(): boolean {
  return (globalThis as { __DEV__?: boolean }).__DEV__ !== false
}

function resolveUseEffect(): UseEffectLike | null {
  const runtime = globalThis as {
    useEffect?: UseEffectLike
    React?: { useEffect?: UseEffectLike }
  }
  return runtime.useEffect ?? runtime.React?.useEffect ?? null
}

function createNoopMiddleware(): DebugMiddleware {
  return () => next => action => next(action)
}

export function initDebugAdapter(options: InitDebugAdapterOptions): DebugAdapterHandle {
  if (!isDevEnabled()) {
    return createNoopHandle()
  }

  return initDebugAdapterCore(options)
}

export function useDebugAdapter(options: InitDebugAdapterOptions): void {
  if (!isDevEnabled()) {
    return
  }

  const useEffect = resolveUseEffect()
  if (!useEffect) {
    void initDebugAdapter(options)
    return
  }

  useEffect(() => {
    const adapter = initDebugAdapter(options)
    return () => {
      adapter.destroy()
    }
  }, [options.store, options.navigationRef, options.mmkvInstances, options.config])
}

export function createDebugMiddleware(): DebugMiddleware {
  if (!isDevEnabled()) {
    return createNoopMiddleware()
  }

  const collector = createReduxCollector<Record<string, unknown>, ActionLike>(() => {})
  return api => {
    ;(api as unknown as Record<PropertyKey, unknown>)[MIDDLEWARE_ATTACHED_SYMBOL] = true
    return collector.middleware(api)
  }
}

export type { ActionLike, AdapterConfig, DebugAdapterHandle, InitDebugAdapterOptions, NavigationContainerRef, ReduxStore } from './types.ts'
