import { describe, expect, it, vi } from 'vitest'
import { DEBUG_EVENT_FIXTURES } from '../../helpers/fixtures.ts'
import { createQueryEventsTool } from '../../../src/tools/query-events.ts'

describe('createQueryEventsTool', () => {
  it('clamps limit, forwards filters to adapter, returns paginated events, and truncates oversized text while preserving structured output', async () => {
    // Arrange
    const connectionManager = {
      isConnected: vi.fn(() => true),
      request: vi.fn(async () => ({
        events: DEBUG_EVENT_FIXTURES.slice(0, 2),
        hasMore: true,
        oldestSeq: 1,
        latestSeq: 50,
      })),
    }

    const tool = createQueryEventsTool(connectionManager, {
      MAX_RESPONSE_CHARS: 80,
    })

    // Act
    const result = await tool.handler({
      stream: 'redux',
      limit: 999,
      since_seq: 10,
      event_type: 'action_dispatched',
    })

    // Assert
    expect(connectionManager.request).toHaveBeenCalledWith('debug_query_events', {
      stream: 'redux',
      limit: 200,
      since_seq: 10,
      event_type: 'action_dispatched',
    })

    expect(result.structuredContent).toEqual({
      events: DEBUG_EVENT_FIXTURES.slice(0, 2),
      hasMore: true,
      oldestSeq: 1,
      latestSeq: 50,
    })
    expect(result.content[0].text.toLowerCase()).toContain('truncated')
  })
})
