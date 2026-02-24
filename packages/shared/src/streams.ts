export const STREAM_NAMES = ['redux', 'navigation', 'mmkv'] as const
export type StreamName = (typeof STREAM_NAMES)[number]

export const REDUX_EVENT_TYPES = ['action_dispatched', 'state_snapshot', 'state_diff'] as const
export const NAVIGATION_EVENT_TYPES = ['route_change', 'navigation_snapshot'] as const
export const MMKV_EVENT_TYPES = ['key_set', 'key_delete', 'storage_snapshot'] as const

export type ReduxEventType = (typeof REDUX_EVENT_TYPES)[number]
export type NavigationEventType = (typeof NAVIGATION_EVENT_TYPES)[number]
export type MmkvEventType = (typeof MMKV_EVENT_TYPES)[number]
export type DebugEventType = ReduxEventType | NavigationEventType | MmkvEventType

export interface StreamEventTypeMap {
  redux: ReduxEventType
  navigation: NavigationEventType
  mmkv: MmkvEventType
}
