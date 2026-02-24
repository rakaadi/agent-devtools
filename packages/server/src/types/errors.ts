export const ERROR_CODES = [
  'NOT_CONNECTED',
  'STREAM_UNAVAILABLE',
  'TIMEOUT',
  'PAYLOAD_TOO_LARGE',
  'PATH_NOT_FOUND',
  'SCOPE_NOT_FOUND',
  'SNAPSHOT_NOT_FOUND',
  'INVALID_PARAMS',
  'ADAPTER_ERROR',
  'INTERNAL_ERROR',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

export interface ToolErrorResponse {
  code: ErrorCode
  message: string
  details?: Record<string, unknown>
}

export interface ToolErrorResult {
  isError: true
  content: Array<{
    type: 'text'
    text: string
  }>
}

const ACTIONABLE_GUIDANCE: Partial<Record<ErrorCode, string>> = {
  NOT_CONNECTED: 'Start your React Native app with the debug adapter enabled, then retry.',
}

const withActionableGuidance = (code: ErrorCode, message: string): string => {
  if (code !== 'NOT_CONNECTED' || !message.includes('No app adapter is connected.')) {
    return message
  }

  const guidance = ACTIONABLE_GUIDANCE[code]
  if (!guidance || message.includes(guidance)) return message
  return `${message} ${guidance}`
}

export function buildToolError(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ToolErrorResult {
  const finalMessage = withActionableGuidance(code, message)

  const payload: ToolErrorResponse = {
    code,
    message: finalMessage,
    ...(details === undefined ? {} : { details }),
  }

  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload),
      },
    ],
  }
}

export function createToolError(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ToolErrorResult {
  return buildToolError(code, message, details)
}
