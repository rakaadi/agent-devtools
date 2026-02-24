import { describe, expect, it, vi } from 'vitest'
import { createGetSnapshotTool } from '../../../src/tools/get-snapshot.ts'

describe('createGetSnapshotTool', () => {
  it('accepts stream and optional scope, requests latest snapshot, filters scoped data, returns SCOPE_NOT_FOUND for missing scope, and returns NOT_CONNECTED when disconnected', async () => {
    // Arrange
    const connectedManager = {
      isConnected: vi.fn(() => true),
      request: vi.fn(async () => ({
        snapshot: {
          user: {
            profile: {
              name: 'Ada',
              role: 'admin',
            },
          },
        },
      })),
    }

    const disconnectedManager = {
      isConnected: vi.fn(() => false),
      request: vi.fn(),
    }

    const connectedTool = createGetSnapshotTool(connectedManager)
    const disconnectedTool = createGetSnapshotTool(disconnectedManager)

    // Act
    const fullSnapshotResult = await connectedTool.handler({ stream: 'redux' })
    const scopedSnapshotResult = await connectedTool.handler({
      stream: 'redux',
      scope: 'user.profile',
    })
    const missingScopeResult = await connectedTool.handler({
      stream: 'redux',
      scope: 'user.preferences',
    })
    const disconnectedResult = await disconnectedTool.handler({ stream: 'redux' })

    // Assert
    expect(connectedManager.request).toHaveBeenCalledWith('debug_get_snapshot', {
      stream: 'redux',
    })
    expect(fullSnapshotResult).toEqual({
      snapshot: {
        user: {
          profile: {
            name: 'Ada',
            role: 'admin',
          },
        },
      },
    })
    expect(scopedSnapshotResult).toEqual({
      snapshot: {
        name: 'Ada',
        role: 'admin',
      },
    })
    expect(JSON.parse(missingScopeResult.content[0].text)).toMatchObject({
      code: 'SCOPE_NOT_FOUND',
    })
    expect(disconnectedManager.request).not.toHaveBeenCalled()
    expect(JSON.parse(disconnectedResult.content[0].text)).toMatchObject({
      code: 'NOT_CONNECTED',
    })
  })
})
