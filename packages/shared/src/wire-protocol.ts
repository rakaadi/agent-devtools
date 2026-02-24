import { z } from 'zod'
import { DebugEventSchema, type DebugEvent } from './debug-event.js'
import { STREAM_NAMES, type StreamName } from './streams.js'

export interface HandshakeMessage {
  type: 'handshake'
  sessionId: string
  adapterVersion: string
  streams: StreamName[]
  deviceInfo?: Record<string, unknown>
}

export interface RequestMessage {
  type: 'request'
  requestId: string
  action: string
  params?: Record<string, unknown>
}

export interface ResponseMessage {
  type: 'response'
  requestId: string
  ok: boolean
  result?: unknown
  error?: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

export interface PushEventMessage {
  type: 'push_event'
  event: DebugEvent
}

export interface ErrorMessage {
  type: 'error'
  requestId?: string
  code: string
  message: string
  details?: Record<string, unknown>
}

export const HandshakeMessageSchema = z.object({
  type: z.literal('handshake'),
  sessionId: z.string().min(1),
  adapterVersion: z.string().min(1),
  streams: z.array(z.enum(STREAM_NAMES)).min(1),
  deviceInfo: z.record(z.string(), z.unknown()).optional(),
})

export const RequestMessageSchema = z.object({
  type: z.literal('request'),
  requestId: z.string().min(1),
  action: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
})

export const ResponseMessageSchema = z.object({
  type: z.literal('response'),
  requestId: z.string().min(1),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional(),
  }).optional(),
})

export const PushEventMessageSchema = z.object({
  type: z.literal('push_event'),
  event: DebugEventSchema,
})

export const ErrorMessageSchema = z.object({
  type: z.literal('error'),
  requestId: z.string().min(1).optional(),
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
})

export const IncomingWireMessageSchema = z.discriminatedUnion('type', [
  HandshakeMessageSchema,
  ResponseMessageSchema,
  PushEventMessageSchema,
  ErrorMessageSchema,
])

export const WireMessageSchema = z.discriminatedUnion('type', [
  HandshakeMessageSchema,
  RequestMessageSchema,
  ResponseMessageSchema,
  PushEventMessageSchema,
  ErrorMessageSchema,
])

export type IncomingWireMessage = z.infer<typeof IncomingWireMessageSchema>
export type WireMessage = z.infer<typeof WireMessageSchema>
