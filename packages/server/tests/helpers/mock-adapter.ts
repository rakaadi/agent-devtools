import {
  DebugEventSchema,
  HandshakeMessageSchema,
  RequestMessageSchema,
  type DebugEvent,
  type RequestMessage,
  type StreamName,
} from '@agent-devtools/shared'
import { WebSocket, type RawData } from 'ws'

type RequestHandler = (request: RequestMessage) => unknown | Promise<unknown>

interface MockAdapterOptions {
  url: string
  origin?: string
  sessionId?: string
  adapterVersion?: string
  streams?: StreamName[]
  deviceInfo?: Record<string, unknown>
}

const toText = (payload: RawData): string => {
  if (typeof payload === 'string') return payload
  if (payload instanceof ArrayBuffer) return Buffer.from(payload).toString('utf8')
  if (Array.isArray(payload)) return Buffer.concat(payload).toString('utf8')
  return payload.toString('utf8')
}

export class MockAdapter {
  private readonly options: Required<Omit<MockAdapterOptions, 'origin'>> & Pick<MockAdapterOptions, 'origin'>
  private socket: WebSocket | null = null
  private readonly requestHandlers = new Map<string, RequestHandler>()
  private readonly staticResponses = new Map<string, unknown>()
  private defaultHandler: RequestHandler | null = null
  private readonly requests: RequestMessage[] = []

  constructor(options: MockAdapterOptions) {
    this.options = {
      url: options.url,
      origin: options.origin,
      sessionId: options.sessionId ?? 'mock-session',
      adapterVersion: options.adapterVersion ?? 'mock-adapter/1.0.0',
      streams: options.streams ?? ['redux', 'navigation'],
      deviceInfo: options.deviceInfo ?? {
        platform: 'test',
      },
    }
  }

  async connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return
    }

    const socket = new WebSocket(this.options.url, {
      headers: this.options.origin ? { origin: this.options.origin } : undefined,
    })

    this.socket = socket

    socket.on('message', payload => {
      void this.handleMessage(payload)
    })

    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => {
        this.sendHandshake()
        resolve()
      })
      socket.once('error', error => {
        reject(error)
      })
    })
  }

  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  async disconnect(code = 1000, reason = 'mock adapter closed'): Promise<void> {
    if (!this.socket) return
    const socket = this.socket

    if (socket.readyState === WebSocket.CLOSED) {
      this.socket = null
      return
    }

    await new Promise<void>(resolve => {
      socket.once('close', () => resolve())
      socket.close(code, reason)
    })

    this.socket = null
  }

  setRequestHandler(action: string, handler: RequestHandler): void {
    this.requestHandlers.set(action, handler)
  }

  setDefaultRequestHandler(handler: RequestHandler): void {
    this.defaultHandler = handler
  }

  setStaticResponse(action: string, result: unknown): void {
    this.staticResponses.set(action, result)
  }

  getRequests(): readonly RequestMessage[] {
    return this.requests
  }

  clearRequests(): void {
    this.requests.length = 0
  }

  sendPushEvent(event: DebugEvent): void {
    const socket = this.ensureConnected()
    const validEvent = DebugEventSchema.parse(event)
    socket.send(JSON.stringify({
      type: 'push_event',
      event: validEvent,
    }))
  }

  private ensureConnected(): WebSocket {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      throw new Error('MockAdapter is not connected')
    }
    return this.socket
  }

  private sendHandshake(): void {
    const socket = this.ensureConnected()
    const handshake = HandshakeMessageSchema.parse({
      type: 'handshake',
      sessionId: this.options.sessionId,
      adapterVersion: this.options.adapterVersion,
      streams: this.options.streams,
      deviceInfo: this.options.deviceInfo,
    })

    socket.send(JSON.stringify(handshake))
  }

  private async handleMessage(payload: RawData): Promise<void> {
    const socket = this.ensureConnected()
    let parsed: unknown

    try {
      parsed = JSON.parse(toText(payload))
    } catch {
      return
    }

    const requestResult = RequestMessageSchema.safeParse(parsed)
    if (!requestResult.success) return

    const request = requestResult.data
    this.requests.push(request)

    try {
      const result = await this.resolveResponse(request)
      socket.send(JSON.stringify({
        type: 'response',
        requestId: request.requestId,
        ok: true,
        result,
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Mock adapter request handler failed'
      socket.send(JSON.stringify({
        type: 'response',
        requestId: request.requestId,
        ok: false,
        error: {
          code: 'ADAPTER_ERROR',
          message,
        },
      }))
    }
  }

  private async resolveResponse(request: RequestMessage): Promise<unknown> {
    if (this.staticResponses.has(request.action)) {
      return this.staticResponses.get(request.action)
    }

    const handler = this.requestHandlers.get(request.action) ?? this.defaultHandler
    if (!handler) {
      throw new Error(`No mock response configured for action: ${request.action}`)
    }

    return handler(request)
  }
}
