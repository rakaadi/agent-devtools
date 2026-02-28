import { describe, expect, it } from 'vitest'
import {
  createRingBuffer,
  createSnapshotSlot,
} from '../../src/buffer/ring-buffer.ts'

describe('createRingBuffer', () => {
  it('uses a default capacity of 200', () => {
    // Arrange
    const buffer = createRingBuffer<string>()

    // Act
    const stats = buffer.stats()

    // Assert
    expect(stats.capacity).toBe(200)
    expect(stats.count).toBe(0)
  })

  it('pushes events, evicts oldest entries at capacity, and keeps seq monotonic', () => {
    // Arrange
    const buffer = createRingBuffer<string>(3)

    // Act
    const seqA = buffer.push('a')
    const seqB = buffer.push('b')
    const seqC = buffer.push('c')
    const seqD = buffer.push('d')

    // Assert
    expect([seqA, seqB, seqC, seqD]).toEqual([1, 2, 3, 4])
    expect(buffer.query({ sinceSeq: 0 })).toEqual({
      events: ['b', 'c', 'd'],
      hasMore: false,
    })
    expect(buffer.stats()).toEqual({
      count: 3,
      oldestSeq: 2,
      latestSeq: 4,
      capacity: 3,
    })
  })

  it('queries with sinceSeq and limit while reporting hasMore correctly', () => {
    // Arrange
    const buffer = createRingBuffer<number>(10)
    for (let index = 1; index <= 5; index += 1) {
      buffer.push(index)
    }

    // Act
    const firstPage = buffer.query({ sinceSeq: 1, limit: 2 })
    const secondPage = buffer.query({ sinceSeq: 3, limit: 2 })

    // Assert
    expect(firstPage).toEqual({
      events: [2, 3],
      hasMore: true,
    })
    expect(secondPage).toEqual({
      events: [4, 5],
      hasMore: false,
    })
  })

  it('supports query filtering and applies limit after filter', () => {
    // Arrange
    const buffer = createRingBuffer<{ id: string, type: 'keep' | 'skip' }>(10)
    const events = [
      { id: 'a', type: 'keep' as const },
      { id: 'b', type: 'skip' as const },
      { id: 'c', type: 'keep' as const },
      { id: 'd', type: 'keep' as const },
    ]
    for (const event of events) {
      buffer.push(event)
    }

    // Act
    const result = buffer.query({
      sinceSeq: 0,
      limit: 2,
      filter: event => event.type === 'keep',
    })

    // Assert
    expect(result).toEqual({
      events: [events[0], events[2]],
      hasMore: true,
    })
  })

  it('returns latest event, supports latest(filter), and handles empty/no-match cases', () => {
    // Arrange
    const buffer = createRingBuffer<{ id: string, type: 'a' | 'b' }>(10)

    // Act + Assert
    expect(buffer.latest()).toBeUndefined()
    expect(buffer.latest(event => event.type === 'a')).toBeUndefined()

    const eventA = { id: '1', type: 'a' as const }
    const eventB = { id: '2', type: 'b' as const }
    const eventA2 = { id: '3', type: 'a' as const }
    buffer.push(eventA)
    buffer.push(eventB)
    buffer.push(eventA2)

    expect(buffer.latest()).toBe(eventA2)
    expect(buffer.latest(event => event.type === 'a')).toBe(eventA2)
    expect(buffer.latest(event => event.type === 'b')).toBe(eventB)
    expect(buffer.latest(event => event.id === 'missing')).toBeUndefined()
  })

  it('clears all events while preserving global seq progression for subsequent pushes', () => {
    // Arrange
    const buffer = createRingBuffer<string>(3)
    const seqOne = buffer.push('one')
    const seqTwo = buffer.push('two')

    // Act
    buffer.clear()
    const seqThree = buffer.push('three')

    // Assert
    expect([seqOne, seqTwo, seqThree]).toEqual([1, 2, 3])
    expect(buffer.query({ sinceSeq: 0 })).toEqual({
      events: ['three'],
      hasMore: false,
    })
    expect(buffer.stats()).toEqual({
      count: 1,
      oldestSeq: 3,
      latestSeq: 3,
      capacity: 3,
    })
  })

  it('handles wrap-around correctly under repeated push and eviction cycles', () => {
    // Arrange
    const buffer = createRingBuffer<number>(3)

    // Act
    for (let value = 1; value <= 6; value += 1) {
      buffer.push(value)
    }

    // Assert
    expect(buffer.query({ sinceSeq: 0 })).toEqual({
      events: [4, 5, 6],
      hasMore: false,
    })
    expect(buffer.stats()).toEqual({
      count: 3,
      oldestSeq: 4,
      latestSeq: 6,
      capacity: 3,
    })
  })

  it('returns empty query/latest responses and zeroed seq stats for an empty buffer', () => {
    // Arrange
    const buffer = createRingBuffer<number>(2)

    // Act + Assert
    expect(buffer.query({})).toEqual({
      events: [],
      hasMore: false,
    })
    expect(buffer.latest()).toBeUndefined()
    expect(buffer.stats()).toEqual({
      count: 0,
      oldestSeq: 0,
      latestSeq: 0,
      capacity: 2,
    })
  })
})

describe('createSnapshotSlot', () => {
  it('stores only the latest snapshot and overwrites previous values', () => {
    // Arrange
    const slot = createSnapshotSlot<{ seq: number, value: string }>()
    const first = { seq: 1, value: 'snapshot-1' }
    const second = { seq: 2, value: 'snapshot-2' }

    // Act + Assert
    expect(slot.get()).toBeUndefined()
    slot.set(first)
    expect(slot.get()).toBe(first)
    slot.set(second)
    expect(slot.get()).toBe(second)
  })

  it('is independent from ring buffer history and supports clear()', () => {
    // Arrange
    const buffer = createRingBuffer<{ seq: number, payload: string }>(5)
    const slot = createSnapshotSlot<{ seq: number, payload: string }>()
    const snapshot1 = { seq: 1, payload: 'state-1' }
    const snapshot2 = { seq: 2, payload: 'state-2' }

    // Act
    buffer.push(snapshot1)
    slot.set(snapshot1)
    buffer.push(snapshot2)
    slot.set(snapshot2)
    slot.clear()

    // Assert
    expect(buffer.query({ sinceSeq: 0 })).toEqual({
      events: [snapshot1, snapshot2],
      hasMore: false,
    })
    expect(slot.get()).toBeUndefined()
  })
})
