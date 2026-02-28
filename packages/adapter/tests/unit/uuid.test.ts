import { describe, expect, it } from 'vitest'
import { uuid } from '../../src/utils/uuid.ts'

describe('uuid', () => {
  it('returns UUIDv4-formatted values and generates a unique value on each call', () => {
    // Arrange
    const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

    // Act
    const values = Array.from({ length: 10 }, () => uuid())

    // Assert
    for (const value of values) {
      expect(value).toMatch(uuidV4Pattern)
    }
    expect(new Set(values).size).toBe(values.length)
  })
})
