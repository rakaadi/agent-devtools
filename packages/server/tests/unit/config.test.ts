import { describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'
import { loadConfig } from '../../src/types/config.ts'

describe('loadConfig', () => {
  it('returns spec defaults when environment variables are absent', () => {
    // Arrange
    const env: NodeJS.ProcessEnv = {}

    // Act
    const config = loadConfig(env)

    // Assert
    expect(config).toEqual({
      WS_PORT: 19850,
      WS_HOST: '127.0.0.1',
      REQUEST_TIMEOUT_MS: 5000,
      MAX_PAYLOAD_SIZE: 1048576,
      MAX_RESPONSE_CHARS: 50000,
      LOG_LEVEL: 'info',
    })
  })

  it('overrides defaults from explicit env vars and coerces numeric values', () => {
    // Arrange
    const env: NodeJS.ProcessEnv = {
      WS_PORT: '20001',
      WS_HOST: '0.0.0.0',
      REQUEST_TIMEOUT_MS: '9000',
      MAX_PAYLOAD_SIZE: '2097152',
      MAX_RESPONSE_CHARS: '75000',
      LOG_LEVEL: 'DEBUG',
    }

    // Act
    const config = loadConfig(env)

    // Assert
    expect(config).toEqual({
      WS_PORT: 20001,
      WS_HOST: '0.0.0.0',
      REQUEST_TIMEOUT_MS: 9000,
      MAX_PAYLOAD_SIZE: 2097152,
      MAX_RESPONSE_CHARS: 75000,
      LOG_LEVEL: 'debug',
    })
  })

  it('emits a security warning when WS_HOST is non-loopback', () => {
    // Arrange
    const env: NodeJS.ProcessEnv = { WS_HOST: '0.0.0.0' }
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    // Act
    loadConfig(env)

    // Assert
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'WebSocket server bound to non-loopback address — debug data is exposed to the network.',
      ),
    )

    consoleWarnSpy.mockRestore()
  })

  it('throws ZodError when numeric env vars are outside valid ranges', () => {
    // Arrange
    const envWithOutOfRangePort: NodeJS.ProcessEnv = { WS_PORT: '70000' }
    const envWithNegativeTimeout: NodeJS.ProcessEnv = { REQUEST_TIMEOUT_MS: '-1' }

    // Act + Assert
    expect(() => loadConfig(envWithOutOfRangePort)).toThrow(ZodError)
    expect(() => loadConfig(envWithNegativeTimeout)).toThrow(ZodError)
  })

  it('throws ZodError when env values violate exact lower bounds or use unsupported log level', () => {
    // Arrange
    const envWithZeroWsPort: NodeJS.ProcessEnv = { WS_PORT: '0' }
    const envWithTooSmallTimeout: NodeJS.ProcessEnv = { REQUEST_TIMEOUT_MS: '99' }
    const envWithInvalidLogLevel: NodeJS.ProcessEnv = { LOG_LEVEL: 'verbose' }

    // Act + Assert
    expect(() => loadConfig(envWithZeroWsPort)).toThrow(ZodError)
    expect(() => loadConfig(envWithTooSmallTimeout)).toThrow(ZodError)
    expect(() => loadConfig(envWithInvalidLogLevel)).toThrow(ZodError)
  })

  it('throws ZodError when timeout, payload size, or response char limits exceed remaining spec bounds', () => {
    // Arrange
    const envWithTooLargeTimeout: NodeJS.ProcessEnv = { REQUEST_TIMEOUT_MS: '30001' }
    const envWithTooSmallPayload: NodeJS.ProcessEnv = { MAX_PAYLOAD_SIZE: '1023' }
    const envWithTooLargePayload: NodeJS.ProcessEnv = { MAX_PAYLOAD_SIZE: '10485761' }
    const envWithTooSmallResponse: NodeJS.ProcessEnv = { MAX_RESPONSE_CHARS: '999' }
    const envWithTooLargeResponse: NodeJS.ProcessEnv = { MAX_RESPONSE_CHARS: '200001' }

    // Act + Assert
    expect(() => loadConfig(envWithTooLargeTimeout)).toThrow(ZodError)
    expect(() => loadConfig(envWithTooSmallPayload)).toThrow(ZodError)
    expect(() => loadConfig(envWithTooLargePayload)).toThrow(ZodError)
    expect(() => loadConfig(envWithTooSmallResponse)).toThrow(ZodError)
    expect(() => loadConfig(envWithTooLargeResponse)).toThrow(ZodError)
  })

  it('returns a frozen config object', () => {
    // Arrange
    const env: NodeJS.ProcessEnv = {}

    // Act
    const config = loadConfig(env)

    // Assert
    expect(Object.isFrozen(config)).toBe(true)
  })
})
