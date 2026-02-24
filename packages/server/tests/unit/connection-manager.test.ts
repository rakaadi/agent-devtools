import { describe, expect, it, vi } from 'vitest'
import { ConnectionManager } from '../../src/ws/connection-manager.ts'

class FakeSocket {
  private listeners = new Map<string, Array<(...args: any[]) => void>>()

  sent: string[] = []
  closeCalls: Array<{ code?: number }> = []

  on(event: string, listener: (...args: any[]) => void): this {
    const existing = this.listeners.get(event) ?? []
    existing.push(listener)
    this.listeners.set(event, existing)
    return this
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(code?: number): void {
    this.closeCalls.push({ code })
  }

  emitMessage(message: unknown): void {
    const payload = typeof message === 'string' ? message : JSON.stringify(message)
    for (const listener of this.listeners.get('message') ?? []) {
      listener(payload)
    }
  }
}

describe('ConnectionManager', () => {
  it('tracks adapter info after handshake, resolves request/response, and rejects in-flight request when connection is replaced', async () => {
    // Arrange
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    const manager = new ConnectionManager({ REQUEST_TIMEOUT_MS: 200, logger })

    const firstSocket = new FakeSocket()
    const secondSocket = new FakeSocket()

    // Act + Assert (handshake -> connected)
    manager.setConnection(firstSocket)
    firstSocket.emitMessage({
      type: 'handshake',
      sessionId: 'session-1',
      adapterVersion: '1.0.0',
      streams: ['redux'],
      deviceInfo: { platform: 'ios' },
    })

    expect(manager.isConnected()).toBe(true)
    expect(manager.getAdapterInfo()).toEqual({
      sessionId: 'session-1',
      adapterVersion: '1.0.0',
      streams: ['redux'],
      deviceInfo: { platform: 'ios' },
    })

    // Act + Assert (one request/response roundtrip)
    const roundtrip = manager.request('debug_get_snapshot', { stream: 'redux' })
    const outboundRequest = JSON.parse(firstSocket.sent[0] as string) as { requestId: string }

    firstSocket.emitMessage({
      type: 'response',
      requestId: outboundRequest.requestId,
      ok: true,
      result: { snapshot: { counter: 1 } },
    })

    await expect(roundtrip).resolves.toEqual({ snapshot: { counter: 1 } })

    // Act + Assert (replacement rejects in-flight + closes old socket)
    const pending = manager.request('debug_get_snapshot', { stream: 'redux' })
    manager.setConnection(secondSocket)

    await expect(pending).rejects.toThrow(/replaced|closed|connection/i)
    expect(firstSocket.closeCalls).toEqual([{ code: 4001 }])
  })
})
