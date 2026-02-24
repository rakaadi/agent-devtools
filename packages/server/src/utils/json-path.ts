const UNSAFE_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

export function resolveJsonPath(obj: unknown, path: string): unknown {
  if (path === '') {
    return obj
  }

  let current: unknown = obj

  for (const segment of path.split('.')) {
    if (UNSAFE_SEGMENTS.has(segment)) {
      return undefined
    }

    if (current === null || current === undefined) {
      return undefined
    }

    current = (current as Record<string, unknown>)[segment]
  }

  return current
}
