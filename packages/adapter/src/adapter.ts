import { createRingBuffer, createSnapshotSlot, type RingBuffer, type SnapshotSlot } from './buffer/ring-buffer.ts'
import { createMmkvCollector, type MmkvCollectorEvent } from './collectors/mmkv.ts'
import { createNavigationCollector, type NavigationCollectorEvent } from './collectors/navigation.ts'
import { createReduxCollector, type ReduxCollectorEvent } from './collectors/redux.ts'
import { createWsClient, type WsClient } from './transport/ws-client.ts'
import { uuid } from './utils/uuid.ts'
import type { DebugEvent, StreamName } from '@agent-devtools/shared'
import type { DebugAdapterHandle, InitDebugAdapterOptions } from './types.ts'

type CollectorEvent = ReduxCollectorEvent | NavigationCollectorEvent | MmkvCollectorEvent

const ADAPTER_VERSION = '0.0.0'
const DEFAULT_SERVER_URL = 'ws://127.0.0.1:19850'

let activeAdapter: DebugAdapterHandle | null = null

function validateConfig(config?: InitDebugAdapterOptions['config']): InitDebugAdapterOptions['config'] {
  if (!config?.serverUrl) {
    return {}
  }

  if (!/^wss?:\/\//.test(config.serverUrl)) {
    throw new Error('serverUrl must start with ws:// or wss://')
  }

  return config
}

export function createNoopHandle(): DebugAdapterHandle {
  return {
    captureSnapshot: () => {},
    destroy: () => {},
    isConnected: () => false,
  }
}

export function initDebugAdapter(options: InitDebugAdapterOptions): DebugAdapterHandle {
  if ((globalThis as { __DEV__?: boolean }).__DEV__ === false) {
    return createNoopHandle()
  }

  if (activeAdapter) {
    activeAdapter.destroy()
    activeAdapter = null
  }

  const config = validateConfig(options.config)
  const sessionId = uuid()

  const ringBuffer: RingBuffer<DebugEvent> = createRingBuffer()
  const snapshots: Record<StreamName, SnapshotSlot<DebugEvent>> = {
    redux: createSnapshotSlot<DebugEvent>(),
    navigation: createSnapshotSlot<DebugEvent>(),
    mmkv: createSnapshotSlot<DebugEvent>(),
  }

  const collectors: Partial<Record<StreamName, { captureSnapshot: () => void, destroy: () => void }>> = {}

  const emitFromCollector = (stream: StreamName, rawEvent: CollectorEvent): void => {
    const { type, ...payload } = rawEvent
    const envelope: DebugEvent = {
      stream,
      event: type,
      timestamp: new Date().toISOString(),
      seq: 0,
      sessionId,
      payload,
      meta: {
        source: stream,
        adapterVersion: ADAPTER_VERSION,
        truncated: false,
      },
    }

    const seq = ringBuffer.push(envelope)
    envelope.seq = seq
    snapshots[stream].set(envelope)
    wsClient.send(envelope)
  }

  if (options.store) {
    collectors.redux = createReduxCollector(event => emitFromCollector('redux', event))
  }

  if (options.navigationRef) {
    collectors.navigation = createNavigationCollector(options.navigationRef, event => emitFromCollector('navigation', event))
  }

  if (options.mmkvInstances) {
    collectors.mmkv = createMmkvCollector(options.mmkvInstances, event => emitFromCollector('mmkv', event))
  }

  const wsClient: WsClient = createWsClient({
    serverUrl: config?.serverUrl ?? DEFAULT_SERVER_URL,
    sessionId,
    adapterVersion: ADAPTER_VERSION,
    enabledStreams: (Object.keys(collectors) as StreamName[]),
  }, {
    get_snapshot: async params => {
      const stream = (params?.stream as StreamName | undefined) ?? 'redux'
      collectors[stream]?.captureSnapshot()
      return snapshots[stream]?.get()
    },
    query_events: async params => {
      const stream = params?.stream as StreamName | undefined
      const sinceSeq = typeof params?.sinceSeq === 'number' ? params.sinceSeq : 0
      const limit = typeof params?.limit === 'number' ? params.limit : 50

      return ringBuffer.query({
        sinceSeq,
        limit,
        filter: stream ? event => event.stream === stream : undefined,
      })
    },
  })

  let destroyed = false

  const handle: DebugAdapterHandle = {
    captureSnapshot: stream => {
      if (stream) {
        collectors[stream]?.captureSnapshot()
        return
      }

      Object.values(collectors).forEach(collector => collector?.captureSnapshot())
    },
    destroy: () => {
      if (destroyed) {
        return
      }
      destroyed = true

      Object.values(collectors).forEach(collector => collector?.destroy())
      void wsClient.disconnect()

      if (activeAdapter === handle) {
        activeAdapter = null
      }
    },
    isConnected: () => wsClient.isConnected(),
  }

  void wsClient.connect().catch(error => {
    console.warn('Debug adapter failed to connect to MCP server', error)
  })

  activeAdapter = handle
  return handle
}
