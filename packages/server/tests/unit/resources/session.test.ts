import { describe, expect, it, vi } from 'vitest'
import { createSessionResource } from '../../../src/resources/session.ts'

describe('createSessionResource', () => {
  it('uses debug://session/current and read() returns JSON text session metadata when connected', async () => {
    // Arrange
    const connectionManager = {
      isConnected: vi.fn(() => true),
      getAdapterInfo: vi.fn(() => ({
        sessionId: 'session-123',
        adapterVersion: '1.2.3',
        uptime: 42,
        connectedAt: '2026-01-01T00:00:00.000Z',
        deviceInfo: { platform: 'ios' },
        streams: ['redux', 'navigation'],
      })),
    }

    const resource = createSessionResource(connectionManager)

    // Act
    const result = await resource.read()

    // Assert
    expect(resource.uri).toBe('debug://session/current')
    expect(result).toMatchObject({
      contents: [
        {
          uri: 'debug://session/current',
          mimeType: 'application/json',
        },
      ],
    })
    expect(JSON.parse(result.contents[0].text)).toEqual({
      sessionId: 'session-123',
      adapterVersion: '1.2.3',
      uptime: 42,
      connectedAt: '2026-01-01T00:00:00.000Z',
      deviceInfo: { platform: 'ios' },
      streams: ['redux', 'navigation'],
    })
  })

  it('read() returns a structured NOT_CONNECTED error payload in JSON text when disconnected', async () => {
    // Arrange
    const connectionManager = {
      isConnected: vi.fn(() => false),
      getAdapterInfo: vi.fn(),
    }

    const resource = createSessionResource(connectionManager)

    // Act
    const result = await resource.read()

    // Assert
    expect(result).toMatchObject({
      contents: [
        {
          uri: 'debug://session/current',
          mimeType: 'application/json',
        },
      ],
    })
    expect(JSON.parse(result.contents[0].text)).toEqual({
      error: {
        code: 'NOT_CONNECTED',
      },
    })
  })
})
