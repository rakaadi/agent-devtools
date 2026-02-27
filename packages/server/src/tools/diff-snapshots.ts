import { z } from 'zod'
import { createToolError } from '../types/errors.ts'

type DiffChange = {
  path: string
  type: 'added' | 'removed' | 'changed'
  oldValue?: unknown
  newValue?: unknown
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function areEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true

  if (isObject(left) && isObject(right)) {
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    if (leftKeys.length !== rightKeys.length) return false

    for (const key of leftKeys) {
      if (!(key in right)) return false
      if (!areEqual(left[key], right[key])) return false
    }

    return true
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false
    for (let i = 0; i < left.length; i += 1) {
      if (!areEqual(left[i], right[i])) return false
    }
    return true
  }

  return false
}

function collectChanges(
  base: unknown,
  target: unknown,
  path: string,
  depth: number,
  maxDepth: number,
  out: DiffChange[],
): void {
  if (isObject(base) && isObject(target)) {
    if (depth >= maxDepth) {
      if (path && !areEqual(base, target)) {
        out.push({ path, type: 'changed' })
      }
      return
    }

    const keys = new Set([...Object.keys(base), ...Object.keys(target)])
    for (const key of keys) {
      const nextPath = path ? `${path}.${key}` : key
      const inBase = key in base
      const inTarget = key in target

      if (!inBase && inTarget) {
        out.push({ path: nextPath, type: 'added', newValue: target[key] })
        continue
      }

      if (inBase && !inTarget) {
        out.push({ path: nextPath, type: 'removed', oldValue: base[key] })
        continue
      }

      collectChanges(base[key], target[key], nextPath, depth + 1, maxDepth, out)
    }

    return
  }

  if (!areEqual(base, target) && path) {
    out.push({ path, type: 'changed', oldValue: base, newValue: target })
  }
}

const ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

const InputSchema = z.object({
  stream: z.enum(['redux', 'navigation', 'mmkv']),
  base_seq: z.number().int().nonnegative(),
  target_seq: z.number().int().nonnegative(),
  max_depth: z.number().int().min(1).max(50).default(10).optional(),
  max_changes: z.number().int().min(1).max(2000).default(500).optional(),
})

const OutputSchema = z.object({
  changes: z.array(z.object({
    path: z.string(),
    type: z.enum(['added', 'removed', 'changed']),
    oldValue: z.unknown().optional(),
    newValue: z.unknown().optional(),
  })),
  baseSeq: z.number().int().nonnegative(),
  targetSeq: z.number().int().nonnegative(),
  truncated: z.boolean(),
  totalChanges: z.number().int().nonnegative(),
})

interface ConnectionManagerLike {
  isConnected?: () => boolean
  request: (action: string, params?: Record<string, unknown>) => Promise<unknown>
}

interface DiffSnapshotsToolDefinition {
  title: string
  description: string
  inputSchema: z.ZodTypeAny
  outputSchema: z.ZodTypeAny
  annotations: typeof ToolAnnotations
  handler: (input: {
    stream: string
    base_seq: number
    target_seq: number
    max_depth?: number
    max_changes?: number
  }) => Promise<unknown>
}

const clampMaxDepth = (value: number | undefined): number => {
  if (value === undefined) return 10
  if (value < 1) return 1
  if (value > 50) return 50
  return value
}

const clampMaxChanges = (value: number | undefined): number => {
  if (value === undefined) return 500
  if (value < 1) return 1
  if (value > 2000) return 2000
  return value
}

export function createDiffSnapshotsTool(
  connectionManager: ConnectionManagerLike,
): DiffSnapshotsToolDefinition {
  return {
    title: 'Diff Debug Snapshots',
    description: 'Compute structural differences between two stream snapshots.',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    annotations: ToolAnnotations,
    handler: async (input: {
      stream: string
      base_seq: number
      target_seq: number
      max_depth?: number
      max_changes?: number
    }) => {
      if (connectionManager.isConnected?.() === false) {
        return createToolError('NOT_CONNECTED', 'No app adapter is connected.')
      }

      const baseResult = await connectionManager.request('debug_get_snapshot', {
        stream: input.stream,
        seq: input.base_seq,
      })

      const targetResult = await connectionManager.request('debug_get_snapshot', {
        stream: input.stream,
        seq: input.target_seq,
      })

      const baseSnapshot = (baseResult as { snapshot?: unknown } | undefined)?.snapshot
      const targetSnapshot = (targetResult as { snapshot?: unknown } | undefined)?.snapshot

      if (baseSnapshot === undefined || targetSnapshot === undefined) {
        return createToolError('SNAPSHOT_NOT_FOUND', 'One or both snapshots were not found.')
      }

      const maxDepth = clampMaxDepth(input.max_depth)
      const maxChanges = clampMaxChanges(input.max_changes)

      const allChanges: DiffChange[] = []
      collectChanges(baseSnapshot, targetSnapshot, '', 0, maxDepth, allChanges)

      return {
        baseSeq: input.base_seq,
        targetSeq: input.target_seq,
        changes: allChanges.slice(0, maxChanges),
        truncated: allChanges.length > maxChanges,
        totalChanges: allChanges.length,
      }
    },
  }
}
