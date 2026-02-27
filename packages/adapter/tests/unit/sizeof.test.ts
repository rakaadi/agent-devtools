import { describe, expect, it } from 'vitest'
import { sizeof } from '../../src/utils/sizeof.ts'

describe('sizeof', () => {
  it('estimates UTF-8 JSON byte length within ±10% for representative primitive and structured payloads', () => {
    // Arrange
    const payloads = [
      null,
      true,
      false,
      0,
      42.5,
      'plain-ascii',
      'こんにちは🌍',
      [1, 'two', false, null],
      { id: 1, ok: true, tag: 'alpha' },
      {
        user: {
          name: 'Ada',
          bio: 'I ❤️ UTF-8',
          tags: ['dev', 'テスト', '🚀'],
        },
        metrics: { visits: [1, 2, 3, 4, 5], ratio: 0.618 },
      },
    ]

    // Act + Assert
    for (const value of payloads) {
      const estimated = sizeof(value)
      const actual = Buffer.byteLength(JSON.stringify(value), 'utf8')
      const delta = Math.abs(estimated - actual)
      const tolerance = Math.max(1, actual * 0.1)

      expect(delta).toBeLessThanOrEqual(tolerance)
    }
  })
})
