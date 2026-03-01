import { z } from 'zod'
import type { ConnectionManagerLike } from '../types/connection-manager.ts'
import { createToolError } from '../types/errors.ts'
import type { ToolDefinition } from '../types/tool.ts'

function clampLimit(limit?: number): number {
  if (typeof limit !== 'number' || Number.isNaN(limit)) return 50
  if (limit < 1) return 1
  if (limit > 200) return 200
  return limit
}

const ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

const InputSchema = z.object({
  stream: z.enum(['redux', 'navigation', 'mmkv']),
  limit: z.number().int().optional(),
  since_seq: z.number().int().nonnegative().optional(),
  event_type: z.string().optional(),
})

const OutputSchema = z.object({
  events: z.array(z.unknown()),
  hasMore: z.boolean(),
  oldestSeq: z.number().int().nullable(),
  latestSeq: z.number().int().nullable(),
})

const QueryEventsResponseSchema = z.object({
  events: z.array(z.unknown()).optional(),
  hasMore: z.boolean().optional(),
  oldestSeq: z.number().int().nullable().optional(),
  latestSeq: z.number().int().nullable().optional(),
})

export function createQueryEventsTool(
  connectionManager: ConnectionManagerLike,
  config: { MAX_RESPONSE_CHARS: number },
): ToolDefinition {
  return {
    title: 'Query Debug Events',
    description: 'Query stream events with filtering, pagination, and bounded response text.',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    annotations: ToolAnnotations,
    handler: async (input: {
      stream?: string
      limit?: number
      since_seq?: number
      event_type?: string
    }) => {
      if (!connectionManager.isConnected()) {
        return createToolError('NOT_CONNECTED', 'No app adapter is connected.')
      }

      const params = {
        stream: input.stream,
        limit: clampLimit(input.limit),
        since_seq: input.since_seq,
        event_type: input.event_type,
      }

      const result = QueryEventsResponseSchema.safeParse(
        await connectionManager.request('debug_query_events', params),
      )

      const structuredContent = {
        events: result.success ? (result.data.events ?? []) : [],
        hasMore: result.success ? (result.data.hasMore ?? false) : false,
        oldestSeq: result.success ? (result.data.oldestSeq ?? null) : null,
        latestSeq: result.success ? (result.data.latestSeq ?? null) : null,
      }

      const rawText = JSON.stringify(structuredContent)
      const text = rawText.length > config.MAX_RESPONSE_CHARS
        ? `${rawText.slice(0, config.MAX_RESPONSE_CHARS)}\n...[TRUNCATED due to MAX_RESPONSE_CHARS]`
        : rawText

      return {
        structuredContent,
        content: [{ type: 'text' as const, text }],
      }
    },
  }
}
