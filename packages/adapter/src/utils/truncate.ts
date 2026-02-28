import { sizeof } from './sizeof.ts'

const TRUNCATED_SENTINEL = '[truncated]'
const MIN_STRING_SIZE = sizeof('')
const MIN_NUMBER_SIZE = sizeof(0)
const MIN_ARRAY_SIZE = sizeof([])
const MIN_OBJECT_SIZE = sizeof({})

function fitWithinLimit(payload: unknown, maxSize: number): unknown {
  if (sizeof(payload) <= maxSize) {
    return payload
  }

  const truncatedSentinel = TRUNCATED_SENTINEL.slice(0, maxSize)
  if (sizeof(truncatedSentinel) <= maxSize) {
    return truncatedSentinel
  }

  if (maxSize >= MIN_STRING_SIZE) {
    return ''
  }

  if (maxSize >= MIN_NUMBER_SIZE) {
    return 0
  }

  return undefined
}

function truncateArray(payload: unknown[], maxSize: number): unknown {
  if (payload.length === 0) {
    return maxSize >= MIN_ARRAY_SIZE ? payload : TRUNCATED_SENTINEL
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
  if (Object.keys(payload).length === 0) {
    return maxSize >= MIN_OBJECT_SIZE ? payload : (TRUNCATED_SENTINEL as unknown as Record<string, unknown>)
  }

  const result: Record<string, unknown> = { ...payload }

  while (sizeof(result) > maxSize) {
    const entries = Object.entries(result)
      .filter(([, value]) => value !== TRUNCATED_SENTINEL)
      .map(([key, value]) => ({ key, value, size: sizeof(value) }))

    if (entries.length > 0) {
      entries.sort((a, b) => b.size - a.size)
      const largest = entries[0]
      const { key, value } = largest

      if (Array.isArray(value)) {
        // Prefer trimming array values instead of discarding them entirely.
        const truncatedArray = truncateArray(value, maxSize)

        if (sizeof(truncatedArray) < sizeof(value)) {
          result[key] = truncatedArray
        } else {
          result[key] = TRUNCATED_SENTINEL
        }
      } else {
        result[key] = TRUNCATED_SENTINEL
      }

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
    const truncatedString = TRUNCATED_SENTINEL.slice(0, Math.max(0, maxSize - 2))

    return {
      payload: fitWithinLimit(truncatedString, maxSize),
      truncated: true,
      originalSize,
    }
  }

  if (Array.isArray(payload)) {
    const truncatedArray = truncateArray(payload, maxSize)

    return {
      payload: fitWithinLimit(truncatedArray, maxSize),
      truncated: true,
      originalSize,
    }
  }

  if (payload && typeof payload === 'object') {
    return {
      payload: fitWithinLimit(truncateObject(payload as Record<string, unknown>, maxSize), maxSize),
      truncated: true,
      originalSize,
    }
  }

  return {
    payload: fitWithinLimit(TRUNCATED_SENTINEL, maxSize),
    truncated: true,
    originalSize,
  }
}
