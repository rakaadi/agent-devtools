import { z } from 'zod'
import { createToolError } from '../types/errors.ts'
import { resolveJsonPath } from '../utils/json-path.ts'

const ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

const InputSchema = z.object({
  stream: z.enum(['redux', 'navigation']).default('redux'),
  path: z.string(),
})

const OutputSchema = z.object({
  value: z.unknown(),
})

interface ConnectionManagerLike {
  isConnected?: () => boolean
  request: (action: string, params?: Record<string, unknown>) => Promise<unknown>
}

interface GetStatePathToolDefinition {
  title: string
  description: string
  inputSchema: z.ZodTypeAny
  outputSchema: z.ZodTypeAny
  annotations: typeof ToolAnnotations
  handler: (input: { path: string, stream?: string }) => Promise<unknown>
}

export function createGetStatePathTool(connectionManager: ConnectionManagerLike): GetStatePathToolDefinition {
  return {
    title: 'Get State Path Value',
    description: 'Resolve a dot-notation path from the latest stream snapshot.',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    annotations: ToolAnnotations,
    handler: async (input: { path: string, stream?: string }) => {
      if (connectionManager.isConnected?.() === false) {
        return createToolError('NOT_CONNECTED', 'No app adapter is connected.')
      }

      const stream = input.stream ?? 'redux'
      const result = (await connectionManager.request('debug_get_snapshot', { stream })) as {
        snapshot?: unknown
      } | undefined
      const value = resolveJsonPath(result?.snapshot, input.path)

      if (value === undefined) {
        return createToolError('PATH_NOT_FOUND', `Path not found: ${input.path}`)
      }

      return { value }
    },
  }
}
