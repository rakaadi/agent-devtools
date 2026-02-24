import { describe, expect, it, vi } from 'vitest'
import { createGetStatePathTool } from '../../../src/tools/get-state-path.ts'

describe('createGetStatePathTool', () => {
  it('defaults stream to redux, resolves dot-notation path from latest snapshot, and returns PATH_NOT_FOUND when unresolved', async () => {
    // Arrange
    const connectionManager = {
      isConnected: vi.fn(() => true),
      request: vi.fn(async () => ({
        snapshot: {
          user: {
            profile: {
              name: 'Ada',
            },
          },
        },
      })),
    }

    const tool = createGetStatePathTool(connectionManager)

    // Act
    const resolvedResult = await tool.handler({ path: 'user.profile.name' })
    const missingPathResult = await tool.handler({ path: 'user.profile.role' })

    // Assert
    expect(connectionManager.request).toHaveBeenCalledWith('debug_get_snapshot', {
      stream: 'redux',
    })
    expect(resolvedResult).toEqual({
      value: 'Ada',
    })
    expect(JSON.parse(missingPathResult.content[0].text)).toMatchObject({
      code: 'PATH_NOT_FOUND',
    })
  })
})
