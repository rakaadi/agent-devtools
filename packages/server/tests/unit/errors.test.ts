import { describe, expect, it } from 'vitest'
import { ERROR_CODES, buildToolError, createToolError } from '../../src/types/errors.ts'

describe('buildToolError', () => {
  it('returns an MCP-compatible error result with JSON text content containing code, message, and details', () => {
    // Arrange
    const code = 'NOT_CONNECTED'
    const message = 'No active MCP session'
    const details = { retryable: true }

    // Act
    const result = buildToolError(code, message, details)
    const parsed = JSON.parse(result.content[0].text)

    // Assert
    expect(result).toMatchObject({
      isError: true,
      content: [{ type: 'text' }],
    })
    expect(parsed).toEqual({
      code,
      message,
      details,
    })
  })

  it('exposes the full spec error-code set and builds MCP error results for each code', () => {
    // Arrange
    const expectedCodes = [
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
    ]

    // Act + Assert
    expect(ERROR_CODES).toEqual(expectedCodes)

    for (const code of ERROR_CODES) {
      const result = buildToolError(code, `Error for ${code}`)
      const parsed = JSON.parse(result.content[0].text)

      expect(result.isError).toBe(true)
      expect(parsed.code).toBe(code)
    }
  })

  it('includes actionable guidance in the message for NOT_CONNECTED errors', () => {
    // Arrange
    const code = 'NOT_CONNECTED'
    const message = 'No app adapter is connected.'

    // Act
    const result = buildToolError(code, message)
    const parsed = JSON.parse(result.content[0].text)

    // Assert
    expect(parsed.message).toContain(
      'Start your React Native app with the debug adapter enabled, then retry.',
    )
  })
})

describe('createToolError', () => {
  it('returns the same MCP-compatible error shape as buildToolError for the same inputs', () => {
    // Arrange
    const code = 'TIMEOUT'
    const message = 'Timed out'
    const details = { requestId: 'abc' }

    // Act
    const result = createToolError(code, message, details)
    const baseline = buildToolError(code, message, details)

    // Assert
    expect(result).toEqual(baseline)
  })
})
