import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createNavigationStateResource } from './resources/navigation-state.ts'
import { createReduxStateResource } from './resources/redux-state.ts'
import { createSessionResource } from './resources/session.ts'
import { createDiffSnapshotsTool } from './tools/diff-snapshots.ts'
import { createGetSnapshotTool } from './tools/get-snapshot.ts'
import { createGetStatePathTool } from './tools/get-state-path.ts'
import { createHealthCheckTool } from './tools/health-check.ts'
import { createListStreamsTool } from './tools/list-streams.ts'
import { createQueryEventsTool } from './tools/query-events.ts'

interface ConnectionManagerLike {
  isConnected: () => boolean
  getAdapterInfo: () => unknown
  request: (action: string, params?: Record<string, unknown>) => Promise<unknown>
}

interface ServerConfigLike {
  MAX_RESPONSE_CHARS: number
}

export interface McpServerLike {
  registerTool: (name: string, metadata: unknown, handler: unknown) => unknown
  registerResource: (name: string, uri: string, metadata: unknown, readHandler: unknown) => unknown
  connect?: (transport: unknown) => Promise<unknown> | unknown
  registeredTools?: unknown[]
  registeredResources?: unknown[]
}

export function createMcpServer(
  connectionManager: ConnectionManagerLike,
  config: ServerConfigLike,
): McpServerLike {
  const serverOptions = {
    name: 'agent-devtools-server',
    version: '0.0.1',
  }

  const maybeConstructor = McpServer as unknown as {
    prototype?: unknown
    (options: typeof serverOptions): McpServerLike
  }
  const server = maybeConstructor.prototype
    ? new (maybeConstructor as unknown as new (options: typeof serverOptions) => McpServerLike)(serverOptions)
    : maybeConstructor(serverOptions)

  const healthCheckTool = createHealthCheckTool(connectionManager)
  server.registerTool('debug_health_check', healthCheckTool, healthCheckTool.handler)

  const listStreamsTool = createListStreamsTool(connectionManager)
  server.registerTool('debug_list_streams', listStreamsTool, listStreamsTool.handler)

  const getSnapshotTool = createGetSnapshotTool(connectionManager)
  server.registerTool('debug_get_snapshot', getSnapshotTool, getSnapshotTool.handler)

  const queryEventsTool = createQueryEventsTool(connectionManager, config)
  server.registerTool('debug_query_events', queryEventsTool, queryEventsTool.handler)

  const getStatePathTool = createGetStatePathTool(connectionManager)
  server.registerTool('debug_get_state_path', getStatePathTool, getStatePathTool.handler)

  const diffSnapshotsTool = createDiffSnapshotsTool(connectionManager)
  server.registerTool('debug_diff_snapshots', diffSnapshotsTool, diffSnapshotsTool.handler)

  const sessionResource = createSessionResource(connectionManager)
  server.registerResource('session', sessionResource.uri, { title: 'Current Debug Session' }, sessionResource.read)

  const reduxStateResource = createReduxStateResource(connectionManager, config)
  server.registerResource('redux-state', reduxStateResource.uri, { title: 'Redux State' }, reduxStateResource.read)

  const navigationStateResource = createNavigationStateResource(connectionManager, config)
  server.registerResource(
    'navigation-state',
    navigationStateResource.uri,
    { title: 'Navigation State' },
    navigationStateResource.read,
  )
  server.registeredTools = [
    'debug_health_check',
    'debug_list_streams',
    'debug_get_snapshot',
    'debug_query_events',
    'debug_get_state_path',
    'debug_diff_snapshots',
  ]
  server.registeredResources = [
    'debug://session/current',
    'debug://redux/state',
    'debug://navigation/state',
  ]

  return server
}
