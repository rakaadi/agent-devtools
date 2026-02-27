import { describe, expect, it } from 'vitest'
import { truncatePayload } from '../../src/utils/truncate.ts'
import { sizeof } from '../../src/utils/sizeof.ts'

describe('truncatePayload', () => {
  it('returns payload unchanged when within size limit', () => {
    // Arrange
    const payload = { event: 'tap', screen: 'Home', count: 3 }

    // Act
    const result = truncatePayload(payload, 10_000)

    // Assert
    expect(result).toEqual({
      payload,
      truncated: false,
      originalSize: expect.any(Number),
    })
  })

  it('progressively truncates largest top-level object properties using the [truncated] sentinel', () => {
    // Arrange
    const payload = {
      keep: 'small',
      largest: 'x'.repeat(20_000),
      secondLargest: 'y'.repeat(10_000),
    }

    // Act
    const result = truncatePayload(payload, 500)

    // Assert
    expect(result.truncated).toBe(true)
    expect(result.payload).toEqual(
      expect.objectContaining({
        keep: 'small',
        largest: '[truncated]',
      }),
    )
    expect(result.payload).not.toEqual(payload)
  })

  it('trims oversized arrays from the end and appends a [... N more items] sentinel', () => {
    // Arrange
    const payload = Array.from({ length: 200 }, (_, index) => `item-${index}`)

    // Act
    const result = truncatePayload(payload, 250)

    // Assert
    expect(result.truncated).toBe(true)
    expect(Array.isArray(result.payload)).toBe(true)

    const truncatedArray = result.payload as unknown[]
    expect(truncatedArray.length).toBeLessThan(payload.length)
    expect(String(truncatedArray[truncatedArray.length - 1])).toMatch(/^\[\.\.\. \d+ more items\]$/)
  })

  it('handles nested structures while preserving truncation markers', () => {
    // Arrange
    const payload = {
      id: 'evt-123',
      nested: {
        user: {
          name: 'Ada',
          notes: 'n'.repeat(15_000),
        },
      },
      meta: { retry: 0 },
    }

    // Act
    const result = truncatePayload(payload, 450)

    // Assert
    expect(result.truncated).toBe(true)
    expect(result.payload).toEqual(
      expect.objectContaining({
        id: 'evt-123',
        meta: { retry: 0 },
      }),
    )
    expect(JSON.stringify(result.payload)).toContain('[truncated]')
  })

  it('handles a single oversized string payload by replacing it with [truncated]', () => {
    // Arrange
    const payload = 's'.repeat(50_000)

    // Act
    const result = truncatePayload(payload, 100)

    // Assert
    expect(result).toEqual({
      payload: '[truncated]',
      truncated: true,
      originalSize: expect.any(Number),
    })
  })
  it('keeps oversized string payload within maxSize even when maxSize is smaller than [truncated]', () => {
    // Arrange
    const payload = 's'.repeat(50_000)
    const maxSize = 5

    // Act
    const result = truncatePayload(payload, maxSize)

    // Assert
    expect(result.truncated).toBe(true)
    expect(sizeof(result.payload)).toBeLessThanOrEqual(maxSize)
  })

  it('keeps oversized array payload within maxSize even when truncation markers cannot fit', () => {
    // Arrange
    const payload = Array.from({ length: 50 }, (_, index) => `item-${index}`)
    const maxSize = 1

    // Act
    const result = truncatePayload(payload, maxSize)

    // Assert
    expect(result.truncated).toBe(true)
    expect(sizeof(result.payload)).toBeLessThanOrEqual(maxSize)
  })

  it('returns payload, truncated flag, and originalSize shape for oversized payloads', () => {
    // Arrange
    const payload = { data: 'z'.repeat(8_000) }

    // Act
    const result = truncatePayload(payload, 120)

    // Assert
    expect(result).toEqual({
      payload: expect.anything(),
      truncated: expect.any(Boolean),
      originalSize: expect.any(Number),
    })
    expect(result.originalSize).toBeGreaterThan(0)
  })

  it('ensures truncated object payload size does not exceed maxSize', () => {
    // Arrange
    const maxSize = 10
    const payload = Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => [`field_${index}`, 'x'.repeat(200)]),
    )

    // Act
    const result = truncatePayload(payload, maxSize)

    // Assert
    expect(result.truncated).toBe(true)
    expect(sizeof(result.payload)).toBeLessThanOrEqual(maxSize)
  })
})
