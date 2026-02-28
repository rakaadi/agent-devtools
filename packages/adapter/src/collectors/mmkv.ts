export interface MmkvCollectorEvent {
  type: 'key_set' | 'key_delete' | 'storage_snapshot'
  [key: string]: unknown
}

export interface MmkvInstance {
  set: (key: string, value: unknown) => void
  delete: (key: string) => void
  getAllKeys: () => string[]
}

export function createMmkvCollector(
  _instances: Record<string, MmkvInstance>,
  _emit: (event: MmkvCollectorEvent) => void,
): {
  captureSnapshot: () => void
  destroy: () => void
} {
  throw new Error('MMKV collector is not yet implemented (Phase D1 prerequisite stub).')
}
