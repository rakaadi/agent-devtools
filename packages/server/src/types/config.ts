import { z } from 'zod'

export const ConfigSchema = z.object({
  WS_PORT: z.coerce.number().int().min(1).max(65535).default(19850),
  WS_HOST: z.string().default('127.0.0.1'),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(5000),
  MAX_PAYLOAD_SIZE: z.coerce.number().int().min(1024).max(10485760).default(1048576),
  MAX_RESPONSE_CHARS: z.coerce.number().int().min(1000).max(200000).default(50000),
  LOG_LEVEL: z
    .preprocess(
      value => (typeof value === 'string' ? value.toLowerCase() : value),
      z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    ),
})

export type Config = z.infer<typeof ConfigSchema>

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = ConfigSchema.parse(env)

  if (!['127.0.0.1', '::1', 'localhost'].includes(config.WS_HOST)) {
    console.warn(
      'WebSocket server bound to non-loopback address — debug data is exposed to the network.',
    )
  }

  return Object.freeze(config)
}
