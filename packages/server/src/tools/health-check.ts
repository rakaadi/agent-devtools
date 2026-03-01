import { z } from 'zod'
import type { ConnectionManagerWithInfo } from '../types/connection-manager.ts'
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
  lastEventAt: z.string().nullable(),
})

const AdapterSchema = z.object({
  sessionId: z.string(),
  adapterVersion: z.string(),
  uptime: z.number().int().nonnegative().optional(),
  connectedAt: z.string().optional(),
}).nullable()

const OutputSchema = z.object({
  connected: z.boolean(),
  adapter: AdapterSchema,
  streams: z.array(StreamMetadataSchema),
})

const StreamsResponseSchema = z.object({
  streams: z.array(StreamMetadataSchema).optional(),
})

export function createHealthCheckTool(connectionManager: ConnectionManagerWithInfo): ToolDefinition {
  return {
    title: 'Debug Health Check',
    description: 'Check adapter connection status and stream metadata.',
    inputSchema: z.object({}),
    outputSchema: OutputSchema,
    annotations: ToolAnnotations,
    handler: async () => {
      if (!connectionManager.isConnected()) {
        return { connected: false, adapter: null, streams: [] }
      }

      const adapter = connectionManager.getAdapterInfo()
      const streamsResponse = StreamsResponseSchema.safeParse(
        await connectionManager.request('debug_list_streams'),
      )

      return {
        connected: true,
        adapter,
        streams: streamsResponse.success ? (streamsResponse.data.streams ?? []) : [],
      }
    },
  }
}
