import { z } from 'zod'
import type { ConnectionManagerLike } from '../types/connection-manager.ts'
import { createToolError } from '../types/errors.ts'
import type { ToolDefinition } from '../types/tool.ts'

const ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

const StreamMetadataSchema = z.object({
  name: z.string(),
  active: z.boolean(),
  eventCount: z.number().int().nonnegative(),
  latestSeq: z.number().int().nonnegative(),
  oldestSeq: z.number().int().nonnegative(),
  hasSnapshot: z.boolean(),
})

const OutputSchema = z.object({
  streams: z.array(StreamMetadataSchema),
})

const StreamsResponseSchema = z.object({
  streams: z.array(StreamMetadataSchema).optional(),
})

export function createListStreamsTool(connectionManager: ConnectionManagerLike): ToolDefinition {
  return {
    title: 'List Debug Streams',
    description: 'List available debug streams and stream metadata.',
    inputSchema: z.object({}),
    outputSchema: OutputSchema,
    annotations: ToolAnnotations,
    handler: async () => {
      if (!connectionManager.isConnected()) {
        return createToolError('NOT_CONNECTED', 'No app adapter is connected.')
      }

      const result = StreamsResponseSchema.safeParse(
        await connectionManager.request('debug_list_streams'),
      )

      return { streams: result.success ? (result.data.streams ?? []) : [] }
    },
  }
}
