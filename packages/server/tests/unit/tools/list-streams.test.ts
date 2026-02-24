import { describe, expect, it, vi } from 'vitest'
import { createListStreamsTool } from '../../../src/tools/list-streams.ts'

describe('createListStreamsTool', () => {
  it('requests stream metadata from the connection manager and returns normalized stream metadata when connected', async () => {
    // Arrange
    const connectionManager = {
      isConnected: vi.fn(() => true),
      request: vi.fn(async () => ({
        streams: [
          {
            name: 'redux',
            active: true,
            eventCount: 42,
            latestSeq: 100,
            oldestSeq: 1,
            hasSnapshot: true,
          },
        ],
      })),
    }

    const tool = createListStreamsTool(connectionManager)

    // Act
    const result = await tool.handler()

    // Assert
    expect(connectionManager.request).toHaveBeenCalledWith('debug_list_streams')
    expect(result).toEqual({
      streams: [
        {
          name: 'redux',
          active: true,
          eventCount: 42,
          latestSeq: 100,
          oldestSeq: 1,
          hasSnapshot: true,
        },
      ],
    })
  })

  it('returns an MCP NOT_CONNECTED tool error payload when no adapter is connected', async () => {
    // Arrange
    const connectionManager = {
      isConnected: vi.fn(() => false),
      request: vi.fn(),
    }

    const tool = createListStreamsTool(connectionManager)

    // Act
    const result = await tool.handler()

    // Assert
    expect(connectionManager.request).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      isError: true,
      content: [{ type: 'text' }],
    })
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      code: 'NOT_CONNECTED',
    })
  })
})
