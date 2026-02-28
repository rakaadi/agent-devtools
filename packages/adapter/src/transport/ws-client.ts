import {
  HandshakeMessageSchema,
  PushEventMessageSchema,
  RequestMessageSchema,
  ResponseMessageSchema,
  type DebugEvent,
} from '@agent-devtools/shared'

type WsMessageData = string | Buffer | ArrayBuffer | Buffer[]

type WsLike = {
  readyState: number
  send: (data: string) => void
  close: () => void
  on: (event: 'open' | 'close' | 'error' | 'message', listener: (...args: unknown[]) => void) => void
}

type WsCtor = new (url: string) => WsLike

interface WsClientConfig {
  serverUrl: string
  sessionId: string
  adapterVersion: string
  enabledStreams: string[]
  deviceInfo?: Record<string, unknown>
  connectTimeout?: number
}

type ActionHandler = (params?: Record<string, unknown>) => Promise<unknown> | unknown

type WsHandlers = Record<string, ActionHandler>

export interface WsClient {
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  isConnected: () => boolean
  send: (event: DebugEvent) => void
}

function toText(data: WsMessageData): string {
  if (typeof data === 'string') {
    return data
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf8')
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf8')
  }

  return data.toString('utf8')
}

export function createWsClient(config: WsClientConfig, handlers: WsHandlers): WsClient {
  if (!/^wss?:\/\//.test(config.serverUrl)) {
    throw new Error('serverUrl must start with ws:// or wss://')
  }

  const WebSocketCtor = (globalThis as { WebSocket?: unknown }).WebSocket as WsCtor | undefined
  if (!WebSocketCtor) {
    console.warn('[adapter] WebSocket is unavailable; using no-op client')

    return {
      connect: async () => {},
      disconnect: async () => {},
      isConnected: () => false,
      send: () => {},
    }
  }

  let socket: WsLike | null = null
  let connected = false

  return {
    connect: () => new Promise<void>((resolve, reject) => {
      if (connected) {
        resolve()
        return
      }

      socket = new WebSocketCtor(config.serverUrl)

      const timeoutMs = config.connectTimeout ?? 5_000
      const timeoutId = setTimeout(() => {
        reject(new Error('WebSocket connection timeout'))
      }, timeoutMs)

      socket.on('open', () => {
        connected = true
        clearTimeout(timeoutId)

        const handshake = HandshakeMessageSchema.parse({
          type: 'handshake',
          sessionId: config.sessionId,
          adapterVersion: config.adapterVersion,
          streams: config.enabledStreams,
          ...(config.deviceInfo ? { deviceInfo: config.deviceInfo } : {}),
        })

        socket?.send(JSON.stringify(handshake))
        resolve()
      })

      socket.on('close', () => {
        connected = false
      })

      socket.on('error', error => {
        clearTimeout(timeoutId)
        if (!connected) {
          reject(error instanceof Error ? error : new Error('WebSocket error'))
        }
      })

      socket.on('message', async payload => {
        let parsed: unknown

        try {
          parsed = JSON.parse(toText(payload as WsMessageData))
        } catch {
          return
        }

        const request = RequestMessageSchema.safeParse(parsed)
        if (!request.success) {
          return
        }

        const handler = handlers[request.data.action]
        if (typeof handler !== 'function') {
          const response = ResponseMessageSchema.parse({
            type: 'response',
            requestId: request.data.requestId,
            ok: false,
            error: {
              code: 'action_not_found',
              message: `Unknown action: ${request.data.action}`,
            },
          })

          socket?.send(JSON.stringify(response))
          return
        }

        try {
          const result = await handler(request.data.params)
          const response = ResponseMessageSchema.parse({
            type: 'response',
            requestId: request.data.requestId,
            ok: true,
            result,
          })

          socket?.send(JSON.stringify(response))
        } catch (error) {
          const response = ResponseMessageSchema.parse({
            type: 'response',
            requestId: request.data.requestId,
            ok: false,
            error: {
              code: 'handler_error',
              message: error instanceof Error ? error.message : 'Handler failed',
            },
          })

          socket?.send(JSON.stringify(response))
        }
      })
    }),
    disconnect: async () => {
      if (!socket) {
        connected = false
        return
      }

      if (socket.readyState >= 2) {
        connected = false
        socket = null
        return
      }

      await new Promise<void>(resolve => {
        socket?.on('close', () => resolve())
        socket?.close()
      })

      connected = false
      socket = null
    },
    isConnected: () => connected,
    send: (event: DebugEvent) => {
      if (!socket || !connected) {
        return
      }

      const message = PushEventMessageSchema.parse({
        type: 'push_event',
        event,
      })

      socket.send(JSON.stringify(message))
    },
  }
}
