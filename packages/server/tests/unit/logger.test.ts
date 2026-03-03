import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLogger } from '../../src/utils/logger.ts'

const baseConfig = {
  REQUEST_TIMEOUT_MS: 5000,
  WS_HOST: '127.0.0.1',
  WS_PORT: 19850,
  MAX_PAYLOAD_SIZE: 1048576,
  MAX_RESPONSE_CHARS: 50000,
} as const

describe('createLogger', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('emits all log levels when LOG_LEVEL is debug', () => {
    // Arrange
    const writeSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const logger = createLogger({
      ...baseConfig,
      LOG_LEVEL: 'debug',
    })

    // Act
    logger.debug('debug message')
    logger.info('info message')
    logger.warn('warn message')
    logger.error('error message')

    // Assert
    expect(writeSpy).toHaveBeenCalledTimes(4)
  })

  it('suppresses messages below configured LOG_LEVEL', () => {
    // Arrange
    const writeSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const logger = createLogger({
      ...baseConfig,
      LOG_LEVEL: 'warn',
    })

    // Act
    logger.debug('debug message')
    logger.info('info message')
    logger.warn('warn message')
    logger.error('error message')

    // Assert
    expect(writeSpy).toHaveBeenCalledTimes(2)
    const [warnLine, errorLine] = writeSpy.mock.calls.map(([line]) => JSON.parse(String(line)))
    expect(warnLine.level).toBe('warn')
    expect(errorLine.level).toBe('error')
  })

  it('serializes log output as JSON with msg, level, and ISO timestamp', () => {
    // Arrange
    const writeSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const logger = createLogger({
      ...baseConfig,
      LOG_LEVEL: 'info',
    })

    // Act
    logger.info('hello')

    // Assert
    const parsed = JSON.parse(String(writeSpy.mock.calls[0]?.[0]))
    expect(parsed).toMatchObject({
      level: 'info',
      msg: 'hello',
    })
    expect(Number.isNaN(Date.parse(parsed.ts))).toBe(false)
    expect(parsed).not.toHaveProperty('data')
  })

  it('includes data field when provided', () => {
    // Arrange
    const writeSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const logger = createLogger({
      ...baseConfig,
      LOG_LEVEL: 'info',
    })
    const payload = { event: 'state_snapshot', stream: 'redux' }

    // Act
    logger.info('with data', payload)

    // Assert
    const parsed = JSON.parse(String(writeSpy.mock.calls[0]?.[0]))
    expect(parsed.data).toEqual(payload)
  })
})
