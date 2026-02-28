import {
  HandshakeMessageSchema,
  PushEventMessageSchema,
  RequestMessageSchema,
  ResponseMessageSchema,
  type DebugEvent,
  type HandshakeMessage,
  type RequestMessage,
  type ResponseMessage,
} from '@agent-devtools/shared'
import { WebSocket, WebSocketServer, type RawData } from 'ws'

interface MockWsServerOptions {
  host?: string
  port?: number
  pollIntervalMs?: number
}

function toText(payload: RawData): string {
  if (typeof payload === 'string') {
    return payload
  }
  if (payload instanceof ArrayBuffer) {
    return Buffer.from(payload).toString('utf8')
  }
  if (Array.isArray(payload)) {
    return Buffer.concat(payload).toString('utf8')
  }
  return payload.toString('utf8')
}

export class MockWsServer {
  private readonly host: string
  private readonly port: number
  private readonly pollIntervalMs: number

  private wss: WebSocketServer | null = null
  private socket: WebSocket | null = null
  private listeningPort: number | null = null
  private requestCounter = 0

  private readonly handshakes: HandshakeMessage[] = []
  private readonly pushEvents: DebugEvent[] = []
  private readonly responses: ResponseMessage[] = []
  private readonly requests: RequestMessage[] = []
  private handshakeCursor = 0
  private pushEventCursor = 0

  constructor(options?: MockWsServerOptions) {
    this.host = options?.host ?? '127.0.0.1'
    this.port = options?.port ?? 0
    this.pollIntervalMs = options?.pollIntervalMs ?? 10
  }

  get url(): string {
    if (this.listeningPort === null) {
      throw new Error('MockWsServer is not started')
    }
    return `ws://${this.host}:${this.listeningPort}`
  }

  getHandshakes(): readonly HandshakeMessage[] {
    return this.handshakes
  }

  getPushEvents(): readonly DebugEvent[] {
    return this.pushEvents
  }

  getResponses(): readonly ResponseMessage[] {
    return this.responses
  }

  getRequests(): readonly RequestMessage[] {
    return this.requests
  }

  async start(): Promise<void> {
    if (this.wss) {
      return
    }

    const server = new WebSocketServer({
      host: this.host,
      port: this.port,
    })
    this.wss = server

    server.on('connection', socket => {
      this.socket = socket
      socket.on('message', payload => {
        this.captureMessage(payload)
      })
      socket.on('close', () => {
        if (this.socket === socket) {
          this.socket = null
        }
      })
    })

    await new Promise<void>((resolve, reject) => {
      server.once('listening', () => resolve())
      server.once('error', error => reject(error))
    })

    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('MockWsServer failed to resolve listening address')
    }
    this.listeningPort = address.port
  }

  async stop(): Promise<void> {
    await this.closeSocket()

    if (!this.wss) {
      this.listeningPort = null
      return
    }

    const server = this.wss
    this.wss = null
    this.listeningPort = null

    await new Promise<void>((resolve, reject) => {
      server.close(error => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
  }

  sendRequest(
    action: string,
    params?: Record<string, unknown>,
    requestId?: string,
  ): string {
    const socket = this.ensureOpenSocket()
    const message = RequestMessageSchema.parse({
      type: 'request',
      requestId: requestId ?? `request-${++this.requestCounter}`,
      action,
      ...(params ? { params } : {}),
    })

    this.requests.push(message)
    socket.send(JSON.stringify(message))
    return message.requestId
  }

  async waitForHandshake(timeoutMs = 1000): Promise<HandshakeMessage> {
    const { message, index } = await this.waitForNextMessage(
      () => this.handshakes,
      this.handshakeCursor,
      handshake => Boolean(handshake),
      timeoutMs,
      'handshake',
    )
    this.handshakeCursor = index + 1
    return message
  }

  async waitForPushEvent(timeoutMs = 1000): Promise<DebugEvent> {
    const { message, index } = await this.waitForNextMessage(
      () => this.pushEvents,
      this.pushEventCursor,
      event => Boolean(event),
      timeoutMs,
      'push event',
    )
    this.pushEventCursor = index + 1
    return message
  }

  async waitForResponse(requestId: string, timeoutMs = 1000): Promise<ResponseMessage> {
    return this.waitForMessage(
      () => this.responses,
      response => response.requestId === requestId,
      timeoutMs,
      `response for requestId=${requestId}`,
    )
  }

  assertLatestHandshake(expected: Partial<HandshakeMessage>): HandshakeMessage {
    const latest = this.handshakes[this.handshakes.length - 1]
    if (!latest) {
      throw new Error('Expected handshake but none was captured')
    }

    const latestRecord = latest as unknown as Record<string, unknown>
    for (const [key, value] of Object.entries(expected)) {
      const actualValue = latestRecord[key]
      if (JSON.stringify(actualValue) !== JSON.stringify(value)) {
        throw new Error(
          `Handshake assertion failed for "${key}": expected ${JSON.stringify(value)}, got ${JSON.stringify(actualValue)}`,
        )
      }
    }

    return latest
  }

  private async closeSocket(): Promise<void> {
    if (!this.socket) {
      return
    }

    const socket = this.socket
    this.socket = null

    if (socket.readyState === WebSocket.CLOSED) {
      return
    }

    await new Promise<void>(resolve => {
      socket.once('close', () => resolve())
      socket.close()
    })
  }

  private ensureOpenSocket(): WebSocket {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      throw new Error('No open client connection available')
    }
    return this.socket
  }

  private captureMessage(payload: RawData): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(toText(payload))
    } catch {
      return
    }

    const handshake = HandshakeMessageSchema.safeParse(parsed)
    if (handshake.success) {
      this.handshakes.push(handshake.data)
      return
    }

    const pushEvent = PushEventMessageSchema.safeParse(parsed)
    if (pushEvent.success) {
      this.pushEvents.push(pushEvent.data.event)
      return
    }

    const response = ResponseMessageSchema.safeParse(parsed)
    if (response.success) {
      this.responses.push(response.data)
    }
  }

  private async waitForMessage<T>(
    source: () => readonly T[],
    predicate: (message: T) => boolean,
    timeoutMs: number,
    label: string,
  ): Promise<T> {
    const startedAt = Date.now()

    return new Promise<T>((resolve, reject) => {
      const check = (): void => {
        const messages = source()
        for (let index = messages.length - 1; index >= 0; index -= 1) {
          const message = messages[index]
          if (predicate(message)) {
            resolve(message)
            return
          }
        }

        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`Timed out waiting for ${label}`))
          return
        }

        setTimeout(check, this.pollIntervalMs)
      }

      check()
    })
  }

  private async waitForNextMessage<T>(
    source: () => readonly T[],
    fromIndex: number,
    predicate: (message: T) => boolean,
    timeoutMs: number,
    label: string,
  ): Promise<{ message: T, index: number }> {
    const startedAt = Date.now()

    return new Promise<{ message: T, index: number }>((resolve, reject) => {
      const check = (): void => {
        const messages = source()
        for (let index = fromIndex; index < messages.length; index += 1) {
          const message = messages[index]
          if (predicate(message)) {
            resolve({ message, index })
            return
          }
        }

        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`Timed out waiting for ${label}`))
          return
        }

        setTimeout(check, this.pollIntervalMs)
      }

      check()
    })
  }
}
