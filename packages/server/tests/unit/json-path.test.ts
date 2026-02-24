import { describe, expect, it } from 'vitest'
import { resolveJsonPath } from '../../src/utils/json-path.ts'

describe('resolveJsonPath', () => {
  it('traverses dot paths, supports array indexes and empty root path, returns undefined for missing/null intermediates, and rejects unsafe segments', () => {
    // Arrange
    const data = {
      user: {
        profile: {
          name: 'Ada',
          tags: ['admin', 'editor'],
        },
        settings: null,
      },
    }

    // Act + Assert
    expect(resolveJsonPath(data, 'user.profile.name')).toBe('Ada')
    expect(resolveJsonPath(data, 'user.profile.tags.1')).toBe('editor')
    expect(resolveJsonPath(data, '')).toBe(data)

    expect(resolveJsonPath(data, 'user.profile.missing')).toBeUndefined()
    expect(resolveJsonPath(data, 'user.settings.theme')).toBeUndefined()

    expect(resolveJsonPath(data, '__proto__.polluted')).toBeUndefined()
    expect(resolveJsonPath(data, 'constructor.prototype')).toBeUndefined()
    expect(resolveJsonPath(data, 'user.prototype.name')).toBeUndefined()
  })
})
