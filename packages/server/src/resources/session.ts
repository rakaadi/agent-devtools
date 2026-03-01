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
      const text = connectionManager.isConnected()
        ? JSON.stringify(connectionManager.getAdapterInfo())
        : JSON.stringify({ error: { code: 'NOT_CONNECTED' } })

      return {
        contents: [
          {
            uri: SESSION_URI,
            mimeType: 'application/json',
            text,
          },
        ],
      }
    },
  }
}
