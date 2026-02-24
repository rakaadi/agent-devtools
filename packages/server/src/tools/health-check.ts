import { z } from 'zod'

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

interface ConnectionManagerLike {
  isConnected: () => boolean
  getAdapterInfo: () => unknown
  request: (action: string, params?: Record<string, unknown>) => Promise<unknown>
}

interface HealthCheckToolDefinition {
  title: string
  description: string
  inputSchema: z.ZodTypeAny
  outputSchema: z.ZodTypeAny
  annotations: typeof ToolAnnotations
  handler: () => Promise<{
    connected: boolean
    adapter: unknown
    streams: unknown[]
  }>
}

export function createHealthCheckTool(connectionManager: ConnectionManagerLike): HealthCheckToolDefinition {
  return {
    title: 'Debug Health Check',
    description: 'Check adapter connection status and stream metadata.',
    inputSchema: z.object({}),
    outputSchema: OutputSchema,
    annotations: ToolAnnotations,
    handler: async () => {
      if (!connectionManager.isConnected()) {
        return {
          connected: false,
          adapter: null,
          streams: [],
        }
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
