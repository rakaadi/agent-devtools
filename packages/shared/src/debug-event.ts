import { z } from 'zod'

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

const DEBUG_EVENT_TYPES = [
  ...REDUX_EVENT_TYPES,
  ...NAVIGATION_EVENT_TYPES,
  ...MMKV_EVENT_TYPES,
] as const

export const DebugEventSchema = z.object({
  stream: z.enum(STREAM_NAMES),
  event: z.enum(DEBUG_EVENT_TYPES),
  timestamp: z.string().min(1),
  seq: z.number().int().nonnegative(),
  sessionId: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  meta: z.object({
    source: z.string().min(1),
    adapterVersion: z.string().min(1),
    truncated: z.boolean(),
    originalSize: z.number().int().nonnegative().optional(),
  }),
})

export type DebugEvent = z.infer<typeof DebugEventSchema>
