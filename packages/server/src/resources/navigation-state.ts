const NAVIGATION_STATE_URI = 'debug://navigation/state'

interface ConnectionManagerLike {
  isConnected: () => boolean
  request: (action: string, params?: Record<string, unknown>) => Promise<unknown>
}

interface NavigationStateResourceConfig {
  MAX_RESPONSE_CHARS: number
}

interface NavigationStateResource {
  uri: string
  read: () => Promise<{
    contents: Array<{
      uri: string
      mimeType: 'application/json'
      text: string
    }>
  }>
}

export function createNavigationStateResource(
  connectionManager: ConnectionManagerLike,
  config: NavigationStateResourceConfig,
): NavigationStateResource {
  return {
    uri: NAVIGATION_STATE_URI,
    read: async () => {
      if (!connectionManager.isConnected()) {
        return {
          contents: [
            {
              uri: NAVIGATION_STATE_URI,
              mimeType: 'application/json',
              text: JSON.stringify({ error: { code: 'NOT_CONNECTED' } }),
            },
          ],
        }
      }

      const result = (await connectionManager.request('debug_get_snapshot', {
        stream: 'navigation',
      })) as { snapshot?: unknown }

      const rawText = JSON.stringify(result.snapshot)
      let text = rawText

      if (rawText.length > config.MAX_RESPONSE_CHARS) {
        text = `${rawText.slice(0, config.MAX_RESPONSE_CHARS)}\n...[TRUNCATED due to MAX_RESPONSE_CHARS]`
      }

      return {
        contents: [
          {
            uri: NAVIGATION_STATE_URI,
            mimeType: 'application/json',
            text,
          },
        ],
      }
    },
  }
}
