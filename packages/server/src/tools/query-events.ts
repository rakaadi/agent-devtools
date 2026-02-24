import { z } from 'zod'
import { createToolError } from '../types/errors.ts'

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

interface ConnectionManagerLike {
  isConnected?: () => boolean
  request: (action: string, params?: Record<string, unknown>) => Promise<unknown>
}

interface QueryEventsToolDefinition {
  title: string
  description: string
  inputSchema: z.ZodTypeAny
  outputSchema: z.ZodTypeAny
  annotations: typeof ToolAnnotations
  handler: (input: {
    stream?: string
    limit?: number
    since_seq?: number
    event_type?: string
  }) => Promise<unknown>
}

export function createQueryEventsTool(
  connectionManager: ConnectionManagerLike,
  config: { MAX_RESPONSE_CHARS: number },
): QueryEventsToolDefinition {
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
      if (connectionManager.isConnected?.() === false) {
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
      const maxChars = config.MAX_RESPONSE_CHARS
      let text = rawText
      if (rawText.length > maxChars) {
        text = `${rawText.slice(0, maxChars)}\n...[TRUNCATED due to MAX_RESPONSE_CHARS]`
      }

      return {
        structuredContent,
        content: [
          {
            type: 'text' as const,
            text,
          },
        ],
      }
    },
  }
}
