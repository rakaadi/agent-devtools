import { describe, expect, it, vi } from 'vitest'
import { createDiffSnapshotsTool } from '../../../src/tools/diff-snapshots.ts'

describe('createDiffSnapshotsTool', () => {
  it('requests base and target snapshots by sequence and returns structural changes while enforcing max_depth and max_changes limits', async () => {
    // Arrange
    const baseSeq = 10
    const targetSeq = 20

    const snapshotsBySeq: Record<number, unknown> = {
      [baseSeq]: {
        user: {
          profile: {
            name: 'Ada',
          },
        },
        count: 1,
        removedRoot: true,
      },
      [targetSeq]: {
        user: {
          profile: {
            name: 'Grace',
          },
        },
        count: 2,
        addedRoot: true,
      },
    }

    const connectionManager = {
      request: vi.fn(async (_method: string, params: { seq: number }) => ({
        snapshot: snapshotsBySeq[params.seq],
      })),
    }

    const tool = createDiffSnapshotsTool(connectionManager)

    // Act
    const depthLimitedResult = await tool.handler({
      stream: 'redux',
      base_seq: baseSeq,
      target_seq: targetSeq,
      max_depth: 1,
      max_changes: 50,
    })

    const truncatedResult = await tool.handler({
      stream: 'redux',
      base_seq: baseSeq,
      target_seq: targetSeq,
      max_depth: 10,
      max_changes: 2,
    })

    // Assert
    expect(connectionManager.request).toHaveBeenNthCalledWith(1, 'debug_get_snapshot', {
      stream: 'redux',
      seq: baseSeq,
    })
    expect(connectionManager.request).toHaveBeenNthCalledWith(2, 'debug_get_snapshot', {
      stream: 'redux',
      seq: targetSeq,
    })

    expect(depthLimitedResult.baseSeq).toBe(baseSeq)
    expect(depthLimitedResult.targetSeq).toBe(targetSeq)
    expect(depthLimitedResult.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'addedRoot', type: 'added' }),
        expect.objectContaining({ path: 'removedRoot', type: 'removed' }),
        expect.objectContaining({ path: 'count', type: 'changed' }),
        expect.objectContaining({ path: 'user', type: 'changed' }),
      ]),
    )
    expect(depthLimitedResult.changes).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'user.profile.name' }),
      ]),
    )

    expect(truncatedResult.truncated).toBe(true)
    expect(truncatedResult.changes).toHaveLength(2)
    expect(truncatedResult.totalChanges).toBeGreaterThan(2)
  })
})
