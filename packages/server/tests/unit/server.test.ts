import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mcpServerConstructorSpy,
  mockServerInstance,
  registerResourceSpy,
  registerToolSpy,
} = vi.hoisted(() => {
  const registerToolSpy = vi.fn()
  const registerResourceSpy = vi.fn()
  const mockServerInstance = {
    registerTool: registerToolSpy,
    registerResource: registerResourceSpy,
  }
  class MockMcpServer {
    constructor() {
      return mockServerInstance
    }
  }

  return {
    registerToolSpy,
    registerResourceSpy,
    mockServerInstance,
    mcpServerConstructorSpy: vi.fn(MockMcpServer),
  }
})

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: mcpServerConstructorSpy,
}))

import { createMcpServer } from '../../src/server.ts'

describe('createMcpServer', () => {
  beforeEach(() => {
    mcpServerConstructorSpy.mockClear()
    registerToolSpy.mockClear()
    registerResourceSpy.mockClear()
  })

  it('returns an MCP server instance and registers all required debug tools and resources', () => {
    // Arrange
    const connectionManager = {
      isConnected: vi.fn(() => false),
      getAdapterInfo: vi.fn(() => null),
      request: vi.fn(async () => ({})),
    }

    const config = {
      REQUEST_TIMEOUT_MS: 5000,
      MAX_RESPONSE_CHARS: 50000,
      MAX_PAYLOAD_SIZE: 1048576,
      LOG_LEVEL: 'info',
      WS_HOST: '127.0.0.1',
      WS_PORT: 19850,
    }

    // Act
    expect(createMcpServer).toBeTypeOf('function')
    const server = createMcpServer(connectionManager, config)

    // Assert
    expect(server).toBe(mockServerInstance)
    expect(mcpServerConstructorSpy).toHaveBeenCalledTimes(1)

    const expectedToolNames = [
      'debug_health_check',
      'debug_list_streams',
      'debug_get_snapshot',
      'debug_query_events',
      'debug_get_state_path',
      'debug_diff_snapshots',
    ]

    const registeredToolNames = registerToolSpy.mock.calls.map(([toolName]) => toolName)
    expect(registeredToolNames).toEqual(expect.arrayContaining(expectedToolNames))
    expect(registerToolSpy).toHaveBeenCalledTimes(6)

    for (const [, metadata] of registerToolSpy.mock.calls) {
      expect(metadata).toEqual(
        expect.objectContaining({
          title: expect.any(String),
          description: expect.any(String),
          inputSchema: expect.anything(),
          outputSchema: expect.anything(),
          annotations: expect.anything(),
        }),
      )
    }

    expect(registerResourceSpy).toHaveBeenCalledTimes(3)
    const registeredResourceArgs = registerResourceSpy.mock.calls.flat()
    expect(registeredResourceArgs).toEqual(
      expect.arrayContaining([
        'debug://session/current',
        'debug://redux/state',
        'debug://navigation/state',
      ]),
    )
  })
})
