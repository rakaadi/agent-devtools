import { z } from 'zod'
import {
  MMKV_EVENT_TYPES,
  NAVIGATION_EVENT_TYPES,
  REDUX_EVENT_TYPES,
  STREAM_NAMES,
} from './streams.js'

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
