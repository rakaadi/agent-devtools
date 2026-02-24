import { describe, expect, it, vi } from 'vitest'
import { createHealthCheckTool } from '../../../src/tools/health-check.ts'

describe('createHealthCheckTool', () => {
  it('returns connected adapter/stream metadata when connected and returns a non-error disconnected payload when no adapter is connected', async () => {
    // Arrange
    const connectedManager = {
      isConnected: vi.fn(() => true),
      getAdapterInfo: vi.fn(() => ({
        sessionId: 'session-123',
        adapterVersion: '1.2.3',
        uptime: 42,
        connectedAt: '2026-01-01T00:00:00.000Z',
      })),
      request: vi.fn(async () => ({
        streams: [
          {
            name: 'redux',
            active: true,
            eventCount: 7,
            lastEventAt: '2026-01-01T00:00:01.000Z',
          },
        ],
      })),
    }

    const disconnectedManager = {
      isConnected: vi.fn(() => false),
      getAdapterInfo: vi.fn(() => null),
      request: vi.fn(),
    }

    const connectedTool = createHealthCheckTool(connectedManager)
    const disconnectedTool = createHealthCheckTool(disconnectedManager)

    // Act
    const connectedResult = await connectedTool.handler()
    const disconnectedResult = await disconnectedTool.handler()

    // Assert
    expect({ connectedResult, disconnectedResult }).toEqual({
      connectedResult: {
        connected: true,
        adapter: {
          sessionId: 'session-123',
          adapterVersion: '1.2.3',
          uptime: 42,
          connectedAt: '2026-01-01T00:00:00.000Z',
        },
        streams: [
          {
            name: 'redux',
            active: true,
            eventCount: 7,
            lastEventAt: '2026-01-01T00:00:01.000Z',
          },
        ],
      },
      disconnectedResult: {
        connected: false,
        adapter: null,
        streams: [],
      },
    })
  })
})
