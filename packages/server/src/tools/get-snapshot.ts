import { z } from 'zod'
import type { ConnectionManagerLike } from '../types/connection-manager.ts'
import { createToolError } from '../types/errors.ts'
import type { ToolDefinition } from '../types/tool.ts'
import { resolveJsonPath } from '../utils/json-path.ts'

const ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

const InputSchema = z.object({
  stream: z.enum(['redux', 'navigation', 'mmkv']),
  scope: z.string().optional(),
})

const OutputSchema = z.object({
  snapshot: z.unknown(),
})

export function createGetSnapshotTool(connectionManager: ConnectionManagerLike): ToolDefinition {
  return {
    title: 'Get Debug Snapshot',
    description: 'Retrieve the latest snapshot for a stream, optionally scoped by JSON path.',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    annotations: ToolAnnotations,
    handler: async (input: { stream: string, scope?: string }) => {
      if (!connectionManager.isConnected()) {
        return createToolError('NOT_CONNECTED', 'No app adapter is connected.')
      }

      const result = (await connectionManager.request('debug_get_snapshot', {
        stream: input.stream,
      })) as { snapshot?: unknown }

      const snapshot = result?.snapshot

      if (!input.scope) {
        return { snapshot }
      }

      const scopedValue = resolveJsonPath(snapshot, input.scope)
      if (scopedValue === undefined) {
        return createToolError('SCOPE_NOT_FOUND', `Scope not found: ${input.scope}`)
      }

      return { snapshot: scopedValue }
    },
  }
}
