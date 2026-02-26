import { describe, expect, it, vi } from 'vitest'
import { createReduxStateResource } from '../../../src/resources/redux-state.ts'

describe('createReduxStateResource', () => {
  it('uses debug://redux/state and connected read() requests latest redux snapshot then returns it as JSON text', async () => {
    // Arrange
    const connectionManager = {
      isConnected: vi.fn(() => true),
      request: vi.fn(async () => ({
        snapshot: {
          counter: 1,
          user: { name: 'Ada' },
        },
      })),
    }

    const config = {
      MAX_RESPONSE_CHARS: 50000,
    }

    const resource = createReduxStateResource(connectionManager, config)

    // Act
    const result = await resource.read()

    // Assert
    expect(resource.uri).toBe('debug://redux/state')
    expect(connectionManager.request).toHaveBeenCalledWith('debug_get_snapshot', {
      stream: 'redux',
    })
    expect(result).toMatchObject({
      contents: [
        {
          uri: 'debug://redux/state',
          mimeType: 'application/json',
        },
      ],
    })
    expect(JSON.parse(result.contents[0].text)).toEqual({
      counter: 1,
      user: { name: 'Ada' },
    })
  })

  it('disconnected read() returns a structured NOT_CONNECTED error payload in JSON text', async () => {
    // Arrange
    const connectionManager = {
      isConnected: vi.fn(() => false),
      request: vi.fn(),
    }

    const config = {
      MAX_RESPONSE_CHARS: 50000,
    }

    const resource = createReduxStateResource(connectionManager, config)

    // Act
    const result = await resource.read()

    // Assert
    expect(result).toMatchObject({
      contents: [
        {
          uri: 'debug://redux/state',
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

  it('applies MAX_RESPONSE_CHARS truncation marker when redux snapshot JSON text is oversized', async () => {
    // Arrange
    const connectionManager = {
      isConnected: vi.fn(() => true),
      request: vi.fn(async () => ({
        snapshot: {
          longText: 'x'.repeat(1000),
        },
      })),
    }

    const config = {
      MAX_RESPONSE_CHARS: 80,
    }

    const resource = createReduxStateResource(connectionManager, config)

    // Act
    const result = await resource.read()

    // Assert
    expect(result.contents[0].text).toContain('...[TRUNCATED due to MAX_RESPONSE_CHARS]')
  })
})
