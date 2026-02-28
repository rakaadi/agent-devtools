import { IncomingWireMessageSchema } from '@agent-devtools/shared'

interface LoggerLike {
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

interface SocketLike {
  on(event: 'message', listener: (data: unknown) => void): unknown
  on(event: 'close', listener: () => void): unknown
  send(data: string): void
  close(code?: number): void
}

interface AdapterInfo {
  sessionId: string
  adapterVersion: string
  streams: string[]
  deviceInfo?: Record<string, unknown>
}

interface ConnectionManagerOptions {
  REQUEST_TIMEOUT_MS: number
  logger: LoggerLike
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  timeout: ReturnType<typeof setTimeout>
}

function parseSocketMessageData(data: unknown): unknown {
  if (typeof data === 'string') {
    return JSON.parse(data)
  }

  if (Buffer.isBuffer(data)) {
    return JSON.parse(data.toString('utf8'))
  }

  return data
}

export class ConnectionManager {
  private readonly requestTimeoutMs: number
  private readonly logger: LoggerLike

  private currentSocket: SocketLike | null = null
  private adapterInfo: AdapterInfo | null = null
  private requestCounter = 0
  private pendingRequests = new Map<string, PendingRequest>()

  constructor(options: ConnectionManagerOptions) {
    this.requestTimeoutMs = options.REQUEST_TIMEOUT_MS
    this.logger = options.logger
  }

  setConnection(socket: SocketLike): void {
    if (this.currentSocket && this.currentSocket !== socket) {
      this.currentSocket.close(4001)
      this.rejectAllPending('Connection replaced')
    }

    this.currentSocket = socket
    this.adapterInfo = null

    socket.on('message', data => {
      this.handleIncomingMessage(data)
    })

    socket.on('close', () => {
      if (this.currentSocket !== socket) return

      this.currentSocket = null
      this.adapterInfo = null
      this.rejectAllPending('Connection closed')
    })
  }

  handleConnection(socket: SocketLike): void {
    this.setConnection(socket)
  }

  isConnected(): boolean {
    return this.adapterInfo !== null
  }

  getAdapterInfo(): AdapterInfo | null {
    return this.adapterInfo
  }

  request(action: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.currentSocket) {
      return Promise.reject(new Error('No connection'))
    }

    const requestId = `req-${++this.requestCounter}`
    this.currentSocket.send(
      JSON.stringify({
        type: 'request',
        requestId,
        action,
        ...(params === undefined ? {} : { params }),
      }),
    )

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId)
        reject(new Error('Request timed out'))
      }, this.requestTimeoutMs)

      this.pendingRequests.set(requestId, { resolve, reject, timeout })
    })
  }

  private handleIncomingMessage(data: unknown): void {
    let parsedJson: unknown

    try {
      parsedJson = parseSocketMessageData(data)
    } catch {
      this.logger.warn('Ignoring non-JSON socket message')
      return
    }

    const parsedMessage = IncomingWireMessageSchema.safeParse(parsedJson)
    if (!parsedMessage.success) {
      this.logger.warn('Ignoring invalid wire message')
      return
    }

    if (parsedMessage.data.type === 'handshake') {
      this.adapterInfo = {
        sessionId: parsedMessage.data.sessionId,
        adapterVersion: parsedMessage.data.adapterVersion,
        streams: parsedMessage.data.streams,
        ...(parsedMessage.data.deviceInfo === undefined
          ? {}
          : { deviceInfo: parsedMessage.data.deviceInfo }),
      }
      return
    }

    if (parsedMessage.data.type === 'response') {
      const pending = this.pendingRequests.get(parsedMessage.data.requestId)
      if (!pending) return

      this.pendingRequests.delete(parsedMessage.data.requestId)
      clearTimeout(pending.timeout)

      if (parsedMessage.data.ok) {
        pending.resolve(parsedMessage.data.result)
      } else {
        pending.reject(new Error(parsedMessage.data.error?.message ?? 'Request failed'))
      }
    }
  }

  private rejectAllPending(reason: string): void {
    for (const [requestId, pending] of this.pendingRequests) {
      this.pendingRequests.delete(requestId)
      clearTimeout(pending.timeout)
      pending.reject(new Error(reason))
    }
  }
}
