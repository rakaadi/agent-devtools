import { describe, expect, it, vi } from 'vitest'
import { createNavigationStateResource } from '../../../src/resources/navigation-state.ts'

describe('createNavigationStateResource', () => {
  it('connected read() returns latest navigation snapshot as JSON text and sends the navigation snapshot request payload', async () => {
    // Arrange
    const connectionManager = {
      isConnected: vi.fn(() => true),
      request: vi.fn(async () => ({
        snapshot: {
          index: 0,
          routes: [{ name: 'Home' }],
        },
      })),
    }

    const config = {
      MAX_RESPONSE_CHARS: 50000,
    }

    const resource = createNavigationStateResource(connectionManager, config)

    // Act
    const result = await resource.read()

    // Assert
    expect(resource.uri).toBe('debug://navigation/state')
    expect(connectionManager.request).toHaveBeenCalledWith('debug_get_snapshot', {
      stream: 'navigation',
    })
    expect(result).toMatchObject({
      contents: [
        {
          uri: 'debug://navigation/state',
          mimeType: 'application/json',
        },
      ],
    })
    expect(JSON.parse(result.contents[0].text)).toEqual({
      index: 0,
      routes: [{ name: 'Home' }],
    })
  })

  it('disconnected read() returns a structured NOT_CONNECTED JSON error payload', async () => {
    // Arrange
    const connectionManager = {
      isConnected: vi.fn(() => false),
      request: vi.fn(),
    }

    const config = {
      MAX_RESPONSE_CHARS: 50000,
    }

    const resource = createNavigationStateResource(connectionManager, config)

    // Act
    const result = await resource.read()

    // Assert
    expect(result).toMatchObject({
      contents: [
        {
          uri: 'debug://navigation/state',
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

  it('applies MAX_RESPONSE_CHARS truncation marker when navigation snapshot JSON text is oversized', async () => {
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

    const resource = createNavigationStateResource(connectionManager, config)

    // Act
    const result = await resource.read()

    // Assert
    expect(result.contents[0].text).toContain('...[TRUNCATED due to MAX_RESPONSE_CHARS]')
  })
})
