export interface RingBufferQueryOptions<T> {
  sinceSeq?: number
  limit?: number
  filter?: (event: T) => boolean
}

export interface RingBufferStats {
  count: number
  oldestSeq: number
  latestSeq: number
  capacity: number
}

export interface RingBuffer<T> {
  push(event: T): number
  query(options: RingBufferQueryOptions<T>): { events: T[], hasMore: boolean }
  latest(filter?: (event: T) => boolean): T | undefined
  stats(): RingBufferStats
  clear(): void
}

export interface SnapshotSlot<T> {
  get(): T | undefined
  set(snapshot: T): void
  clear(): void
}

export function createRingBuffer<T>(capacity = 200): RingBuffer<T> {
  const events: Array<T | undefined> = Array.from({ length: capacity }, () => undefined)
  const seqs: Array<number | undefined> = Array.from({ length: capacity }, () => undefined)

  let count = 0
  let head = 0
  let oldestSeq = 0
  let latestSeq = 0
  let nextSeq = 1

  return {
    push(event) {
      const seq = nextSeq
      nextSeq += 1

      let index: number
      if (count < capacity) {
        index = (head + count) % capacity
        count += 1
        if (oldestSeq === 0) {
          oldestSeq = seq
        }
      } else {
        index = head
        head = (head + 1) % capacity
        oldestSeq = seq - capacity + 1
      }

      events[index] = event
      seqs[index] = seq
      latestSeq = seq

      return seq
    },

    query(options) {
      const sinceSeq = options.sinceSeq ?? 0
      const limit = options.limit ?? Number.POSITIVE_INFINITY
      const filter = options.filter

      const result: T[] = []
      let hasMore = false

      for (let offset = 0; offset < count; offset += 1) {
        const index = (head + offset) % capacity
        const seq = seqs[index]
        const event = events[index]

        if (seq === undefined || event === undefined || seq <= sinceSeq) {
          continue
        }

        if (filter && !filter(event)) {
          continue
        }

        if (result.length < limit) {
          result.push(event)
        } else {
          hasMore = true
          break
        }
      }

      return {
        events: result,
        hasMore,
      }
    },

    latest(filter) {
      for (let offset = count - 1; offset >= 0; offset -= 1) {
        const index = (head + offset) % capacity
        const event = events[index]

        if (event === undefined) {
          continue
        }

        if (!filter || filter(event)) {
          return event
        }
      }

      return undefined
    },

    stats() {
      return {
        count,
        oldestSeq: count > 0 ? oldestSeq : 0,
        latestSeq: count > 0 ? latestSeq : 0,
        capacity,
      }
    },

    clear() {
      count = 0
      head = 0
      oldestSeq = 0
      latestSeq = 0
      events.fill(undefined)
      seqs.fill(undefined)
    },
  }
}

export function createSnapshotSlot<T>(): SnapshotSlot<T> {
  let snapshot: T | undefined

  return {
    get() {
      return snapshot
    },

    set(value) {
      snapshot = value
    },

    clear() {
      snapshot = undefined
    },
  }
}
