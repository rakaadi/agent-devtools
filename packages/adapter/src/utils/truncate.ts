import { sizeof } from './sizeof.ts'

const TRUNCATED_SENTINEL = '[truncated]'

function truncateArray(payload: unknown[], maxSize: number): unknown[] {
  if (payload.length === 0) {
    return payload
  }

  for (let keepCount = payload.length - 1; keepCount >= 0; keepCount -= 1) {
    const removedCount = payload.length - keepCount
    const candidate = payload.slice(0, keepCount)

    if (removedCount > 0) {
      candidate.push(`[... ${removedCount} more items]`)
    }

    if (sizeof(candidate) <= maxSize) {
      return candidate
    }
  }

  const fullyTruncated = [`[... ${payload.length} more items]`]
  if (sizeof(fullyTruncated) <= maxSize) {
    return fullyTruncated
  }

  return [TRUNCATED_SENTINEL]
}

function truncateObject(payload: Record<string, unknown>, maxSize: number): Record<string, unknown> {
  const result: Record<string, unknown> = { ...payload }

  while (sizeof(result) > maxSize) {
    const entries = Object.entries(result)
      .filter(([, value]) => value !== TRUNCATED_SENTINEL)
      .map(([key, value]) => ({ key, size: sizeof(value) }))

    if (entries.length > 0) {
      entries.sort((a, b) => b.size - a.size)
      result[entries[0].key] = TRUNCATED_SENTINEL
      continue
    }

    const keys = Object.keys(result)
    if (keys.length === 0) {
      break
    }

    delete result[keys[0]]
  }

  return result
}

export function truncatePayload(payload: unknown, maxSize: number): {
  payload: unknown
  truncated: boolean
  originalSize: number
} {
  const originalSize = sizeof(payload)

  if (originalSize <= maxSize) {
    return {
      payload,
      truncated: false,
      originalSize,
    }
  }

  if (typeof payload === 'string') {
    return {
      payload: TRUNCATED_SENTINEL,
      truncated: true,
      originalSize,
    }
  }

  if (Array.isArray(payload)) {
    return {
      payload: truncateArray(payload, maxSize),
      truncated: true,
      originalSize,
    }
  }

  if (payload && typeof payload === 'object') {
    return {
      payload: truncateObject(payload as Record<string, unknown>, maxSize),
      truncated: true,
      originalSize,
    }
  }

  return {
    payload: TRUNCATED_SENTINEL,
    truncated: true,
    originalSize,
  }
}
