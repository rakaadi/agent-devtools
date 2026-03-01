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
import type { ConnectionManagerWithInfo } from './types/connection-manager.ts'

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

interface ToolHandler {
  (...args: unknown[]): Promise<unknown> | unknown
}

function hasToolError(result: unknown): boolean {
  if (typeof result !== 'object' || result === null) {
    return false
  }

  if (!('isError' in result)) {
    return false
  }

  return (result as { isError?: unknown }).isError === true
}

function createStructuredToolHandler(
  handler: ToolHandler,
  preserveToolError: boolean,
): (...args: unknown[]) => Promise<unknown> {
  return async function structuredToolHandler(...args: unknown[]): Promise<unknown> {
    const result = await handler(...args)

    if (preserveToolError && hasToolError(result)) {
      return result
    }

    return {
      content: [],
      structuredContent: result as Record<string, unknown>,
      isError: false,
    }
  }
}

export function createMcpServer(
  connectionManager: ConnectionManagerWithInfo,
  config: ServerConfigLike,
): McpServerLike {
  const server = new McpServer({
    name: 'agent-devtools-server',
    version: '0.0.1',
  }) as unknown as McpServerLike

  const toolNames: string[] = []
  const resourceUris: string[] = []

  function registerTool(name: string, definition: unknown, handler: unknown): void {
    server.registerTool(name, definition, handler)
    toolNames.push(name)
  }

  function registerResource(name: string, uri: string, metadata: unknown, readHandler: unknown): void {
    server.registerResource(name, uri, metadata, readHandler)
    resourceUris.push(uri)
  }

  const healthCheckTool = createHealthCheckTool(connectionManager)
  registerTool(
    'debug_health_check',
    healthCheckTool,
    createStructuredToolHandler(healthCheckTool.handler as ToolHandler, false),
  )

  const listStreamsTool = createListStreamsTool(connectionManager)
  registerTool('debug_list_streams', listStreamsTool, listStreamsTool.handler)

  const getSnapshotTool = createGetSnapshotTool(connectionManager)
  registerTool(
    'debug_get_snapshot',
    getSnapshotTool,
    createStructuredToolHandler(getSnapshotTool.handler as ToolHandler, true),
  )

  const queryEventsTool = createQueryEventsTool(connectionManager, config)
  registerTool('debug_query_events', queryEventsTool, queryEventsTool.handler)

  const getStatePathTool = createGetStatePathTool(connectionManager)
  registerTool('debug_get_state_path', getStatePathTool, getStatePathTool.handler)

  const diffSnapshotsTool = createDiffSnapshotsTool(connectionManager)
  registerTool('debug_diff_snapshots', diffSnapshotsTool, diffSnapshotsTool.handler)

  const sessionResource = createSessionResource(connectionManager)
  registerResource('session', sessionResource.uri, { title: 'Current Debug Session' }, sessionResource.read)

  const reduxStateResource = createReduxStateResource(connectionManager, config)
  registerResource('redux-state', reduxStateResource.uri, { title: 'Redux State' }, reduxStateResource.read)

  const navigationStateResource = createNavigationStateResource(connectionManager, config)
  registerResource(
    'navigation-state',
    navigationStateResource.uri,
    { title: 'Navigation State' },
    navigationStateResource.read,
  )

  server.registeredTools = toolNames
  server.registeredResources = resourceUris

  return server
}
