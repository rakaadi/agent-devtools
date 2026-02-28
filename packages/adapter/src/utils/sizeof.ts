const encoder = new TextEncoder()

function utf8Bytes(text: string): number {
  return encoder.encode(text).length
}

function isJsonOmitted(value: unknown): value is undefined | symbol | ((...args: unknown[]) => unknown) {
  return value === undefined || typeof value === 'function' || typeof value === 'symbol'
}

function sizeOfJson(value: unknown, seen: WeakSet<object>, key: string): number {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return utf8Bytes(JSON.stringify(value))
  }

  if (Array.isArray(value)) {
    const arrayValue = value as unknown[]

    if (seen.has(arrayValue)) {
      return 4
    }

    seen.add(arrayValue)

    let total = 2
    for (let i = 0; i < arrayValue.length; i += 1) {
      if (i > 0) {
        total += 1
      }

      const item = arrayValue[i]
      if (isJsonOmitted(item)) {
        total += 4
      } else {
        total += sizeOfJson(item, seen, String(i))
      }
    }

    return total
  }

  if (typeof value === 'object') {
    const objectValue = value as Record<string, unknown> & { toJSON?: (jsonKey: string) => unknown }

    if (typeof objectValue.toJSON === 'function') {
      const serializedValue = objectValue.toJSON(key)

      if (isJsonOmitted(serializedValue)) {
        return 4
      }

      return sizeOfJson(serializedValue, seen, key)
    }

    if (seen.has(objectValue)) {
      return 4
    }

    seen.add(objectValue)

    let total = 2
    let isFirst = true

    for (const [key, item] of Object.entries(objectValue)) {
      if (isJsonOmitted(item)) {
        continue
      }

      if (!isFirst) {
        total += 1
      }

      total += utf8Bytes(JSON.stringify(key))
      total += 1
      total += sizeOfJson(item, seen, key)
      isFirst = false
    }

    return total
  }

  return 4
}

export function sizeof(value: unknown): number {
  if (isJsonOmitted(value)) {
    return 0
  }

  return sizeOfJson(value, new WeakSet(), '')
}
