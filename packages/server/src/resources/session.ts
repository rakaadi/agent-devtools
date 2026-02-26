import { createToolError } from '../types/errors.ts'

const SESSION_URI = 'debug://session/current'

interface ConnectionManagerLike {
  isConnected: () => boolean
  getAdapterInfo: () => unknown
}

interface SessionResource {
  uri: string
  read: () => Promise<{
    contents: Array<{
      uri: string
      mimeType: 'application/json'
      text: string
    }>
  }>
}

export function createSessionResource(connectionManager: ConnectionManagerLike): SessionResource {
  return {
    uri: SESSION_URI,
    read: async () => {
      if (!connectionManager.isConnected()) {
        const toolError = createToolError('NOT_CONNECTED', 'No app adapter is connected.')
        const parsed = JSON.parse(toolError.content[0].text) as { code: string }

        return {
          contents: [
            {
              uri: SESSION_URI,
              mimeType: 'application/json',
              text: JSON.stringify({ error: { code: parsed.code } }),
            },
          ],
        }
      }

      return {
        contents: [
          {
            uri: SESSION_URI,
            mimeType: 'application/json',
            text: JSON.stringify(connectionManager.getAdapterInfo()),
          },
        ],
      }
    },
  }
}
