import { sizeof } from './sizeof.js'

const TRUNCATED_SENTINEL = '[truncated]'
const MIN_STRING_SIZE = sizeof('')
const MIN_NUMBER_SIZE = sizeof(0)

function fitWithinLimit(payload: unknown, maxSize: number): unknown {
  if (sizeof(payload) <= maxSize) {
    return payload
  }

  if (maxSize >= MIN_STRING_SIZE) {
    return ''
  }

  if (maxSize >= MIN_NUMBER_SIZE) {
    return 0
  }

  return undefined
}

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
    let largestKey: string | undefined
    let largestSize = -1

    for (const [key, value] of Object.entries(result)) {
      if (value === TRUNCATED_SENTINEL) {
        continue
      }

      const valueSize = sizeof(value)
      if (valueSize > largestSize) {
        largestSize = valueSize
        largestKey = key
      }
    }

    if (largestKey !== undefined) {
      result[largestKey] = TRUNCATED_SENTINEL
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
