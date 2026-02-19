# Agent DevTools MCP Server — Technical Specification

> **Version:** 1.0
> **Status:** Draft
> **Last Updated:** 2026-02-17
> **Parent Spec:** [Debug Data Adapter and MCP Server Specification](./Debug%20Data%20Adapter%20and%20MCP%20Server%20Specification.md)

---

## 1) Scope

This document specifies the **MCP Debug Server** component only — a standalone Node.js/Bun process that exposes React Native app debug data to AI agents via the [Model Context Protocol](https://modelcontextprotocol.io). It covers the server's architecture, tool/resource surface, configuration, project structure, testing strategy, and a fine-grained implementation plan for AI agent execution.

### What this spec covers

- MCP server process: lifecycle, configuration, entry point.
- WebSocket server: accepts connections from in-app debug adapters.
- MCP tool and resource definitions: inputs, outputs, schemas, error handling.
- Project structure: file layout, dependency manifest.
- Testing strategy: unit, integration, contract tests.
- Implementation work phases: fine-grained, dependency-ordered tasks for AI agents.

### What this spec does NOT cover

- In-app debug data adapter (collectors, ring buffers, transport client) — lives in the consumer app.
- WebSocket wire protocol between app adapter and MCP server — defined in a separate shared spec, referenced here.
- Rozenite plugins — untouched, per the parent spec's non-interference guarantee.

### Design principles

1. **App-agnostic.** Any React Native app that implements the wire protocol can connect. No hardcoded assumptions about any specific app's store shape, navigation structure, or storage instances.
2. **Stateless.** The MCP server holds no persistent state. All state lives in the connected app's ring buffers. The server is a translation layer between MCP clients and the app adapter.
3. **Dev-only.** The server is a development tool. It binds to localhost only and makes no attempt to secure data beyond that boundary.
4. **Minimal dependencies.** Only add what's strictly necessary for the MCP protocol, WebSocket communication, and schema validation.

---

## 2) Architecture

```text
┌─────────────────────────────────────┐
│  React Native App (DEV)             │
│  ┌───────────────────────────────┐  │
│  │  Debug Data Adapter           │  │
│  │  (collectors + ring buffers)  │  │
│  │  ┌─────────────────────────┐  │  │
│  │  │  WebSocket Client       │  │  │
│  │  │  (connects TO server)   │  │  │
│  │  └────────────┬────────────┘  │  │
│  └───────────────┼───────────────┘  │
└──────────────────┼──────────────────┘
                   │ WS (localhost:19850)
                   │ Wire Protocol (see §2a)
┌──────────────────▼──────────────────┐
│  Agent DevTools MCP Server          │
│  (this spec)                        │
│                                     │
│  ┌──────────────────────────────┐   │
│  │  WebSocket Server (ws)       │   │
│  │  - Accept adapter connection │   │
│  │  - Route requests/responses  │   │
│  │  - Handle push events        │   │
│  └──────────────┬───────────────┘   │
│                 │                    │
│  ┌──────────────▼───────────────┐   │
│  │  Connection Manager          │   │
│  │  - Track connected adapters  │   │
│  │  - Health monitoring         │   │
│  │  - Request/response routing  │   │
│  └──────────────┬───────────────┘   │
│                 │                    │
│  ┌──────────────▼───────────────┐   │
│  │  MCP Server (SDK)            │   │
│  │  - Tool registration         │   │
│  │  - Resource registration     │   │
│  │  - Schema validation (Zod)   │   │
│  └──────────────┬───────────────┘   │
│                 │ stdio             │
└─────────────────┼───────────────────┘
                  │
┌─────────────────▼───────────────────┐
│  MCP Client                         │
│  (Copilot CLI, Claude Code, Cursor) │
└─────────────────────────────────────┘
```

### 2a) Wire Protocol Reference

The WebSocket wire protocol between the app adapter and the MCP server is a separate shared contract. Both sides must implement it. This spec references it as **Wire Protocol v1** and assumes the following capabilities exist:

- **Request/Response**: MCP server sends a typed request over WebSocket, app adapter responds with data.
- **Push Events**: App adapter pushes new debug events to the MCP server (for real-time streaming, optional).
- **Handshake**: On connection, the adapter sends a handshake message identifying itself (session ID, adapter version, available streams).

The wire protocol spec will define message shapes, error codes, and reconnection semantics. This MCP server spec defines only what the server does with the data it receives.

### 2b) Transport layers

| Layer | Protocol | Port | Phase |
|---|---|---|---|
| App adapter → MCP Server | WebSocket (reverse: server listens, app connects) | `19850` (default, configurable) | v1 |
| MCP Server → AI Client | stdio | N/A | v1 |
| MCP Server → AI Client | Streamable HTTP | `3100` (configurable) | Deferred (Phase 4) |

**Reverse WebSocket rationale**: The MCP server runs a WebSocket server; the in-app adapter connects to it. This avoids the app exposing a server port, handles reconnection gracefully (app retries on disconnect), and works across simulator, emulator, and physical device on the same network.

---

## 3) MCP Tool Surface

All tools use structured JSON input validated with Zod schemas. All tools return MCP-compliant `CallToolResult` with `content` arrays.

### 3a) `debug_health_check`

**Purpose**: Check connection status and adapter capabilities.

**Parameters**: None.

**Returns**:

```typescript
{
  connected: boolean
  adapter: {
    sessionId: string
    adapterVersion: string
    uptime: number           // seconds since adapter started
    connectedAt: string      // ISO 8601 timestamp
  } | null
  streams: {
    name: string             // 'redux' | 'navigation' | 'mmkv'
    active: boolean
    eventCount: number
    lastEventAt: string | null
  }[]
}
```

**Behavior**:
- If no adapter is connected, returns `{ connected: false, adapter: null, streams: [] }`.
- No error thrown for disconnected state — this tool is specifically for checking connectivity.

### 3b) `debug_list_streams`

**Purpose**: List available data streams and their status.

**Parameters**: None.

**Returns**:

```typescript
{
  streams: {
    name: string
    active: boolean
    eventCount: number
    latestSeq: number
    oldestSeq: number
    hasSnapshot: boolean
  }[]
}
```

**Behavior**:
- Queries the connected adapter for current stream metadata.
- Returns empty array if not connected (with `isError: true` in MCP response).

### 3c) `debug_get_snapshot`

**Purpose**: Retrieve the latest state snapshot for a given stream.

**Parameters**:

| Param | Type | Required | Description |
|---|---|---|---|
| `stream` | `'redux' \| 'navigation' \| 'mmkv'` | Yes | Target stream |
| `scope` | `string` | No | JSON path for partial snapshot (e.g., `"auth.user"` for Redux, instance name for MMKV) |

**Returns**: The latest snapshot payload for the specified stream, scoped if `scope` is provided. Shape depends on the stream type (see parent spec §5 for stream-specific event payloads).

**Errors**:
- `NOT_CONNECTED`: No adapter connected.
- `STREAM_UNAVAILABLE`: Requested stream is not active.
- `SCOPE_NOT_FOUND`: The `scope` path does not exist in the snapshot.

### 3d) `debug_query_events`

**Purpose**: Query events from a stream's ring buffer with filtering and pagination.

**Parameters**:

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `stream` | `'redux' \| 'navigation' \| 'mmkv'` | Yes | — | Target stream |
| `limit` | `number` | No | `50` | Max events to return (1–200) |
| `since_seq` | `number` | No | — | Return events after this sequence number |
| `event_type` | `string` | No | — | Filter by event type (e.g., `'action_dispatched'`, `'route_change'`) |

**Returns**:

```typescript
{
  events: DebugEvent[]       // Ordered by seq ascending
  hasMore: boolean           // True if more events exist beyond the limit
  oldestSeq: number          // Oldest seq in the buffer
  latestSeq: number          // Latest seq in the buffer
}
```

**Behavior**:
- Events are returned in ascending `seq` order.
- If `since_seq` is provided, returns events with `seq > since_seq`.
- `limit` is clamped to [1, 200].

### 3e) `debug_get_state_path`

**Purpose**: Read a specific value from the Redux state tree by dot-notation path.

**Parameters**:

| Param | Type | Required | Description |
|---|---|---|---|
| `path` | `string` | Yes | Dot-notation path (e.g., `"api.queries"`, `"auth.user.role"`) |

**Returns**: The value at the specified path, JSON-serialized.

**Errors**:
- `NOT_CONNECTED`: No adapter connected.
- `STREAM_UNAVAILABLE`: Redux stream not active.
- `PATH_NOT_FOUND`: The path does not resolve to a value in the current state.

### 3f) `debug_diff_snapshots`

**Purpose**: Compute a structural diff between two snapshots of the same stream.

**Parameters**:

| Param | Type | Required | Description |
|---|---|---|---|
| `stream` | `'redux' \| 'navigation' \| 'mmkv'` | Yes | Target stream |
| `base_seq` | `number` | Yes | Sequence number of the base snapshot |
| `target_seq` | `number` | Yes | Sequence number of the target snapshot |

**Returns**:

```typescript
{
  changes: {
    path: string
    type: 'added' | 'removed' | 'changed'
    oldValue?: unknown
    newValue?: unknown
  }[]
  baseSeq: number
  targetSeq: number
}
```

**Errors**:
- `NOT_CONNECTED`: No adapter connected.
- `STREAM_UNAVAILABLE`: Requested stream not active.
- `SNAPSHOT_NOT_FOUND`: One or both sequence numbers don't correspond to a snapshot in the buffer.

---

## 4) MCP Resource Surface

Resources provide read-only, URI-addressable access to current state. They are suitable for LLM context injection (e.g., "attach the current Redux state to this conversation").

### 4a) Static resources

| URI | Description | Returns |
|---|---|---|
| `debug://session/current` | Current debug session metadata | `{ sessionId, adapterVersion, uptime, deviceInfo, connectedAt, streams }` |
| `debug://redux/state` | Latest full Redux state snapshot | Full state object (size-capped per parent spec limits) |
| `debug://navigation/state` | Latest navigation state snapshot | Navigation state tree (`{ routes, index, stale }`) |

### 4b) Dynamic resources (Phase 3)

| URI Pattern | Description | Returns |
|---|---|---|
| `debug://mmkv/{instance}` | Latest MMKV snapshot for a named instance | `{ instance, keys, totalSize }` |

Dynamic resources use MCP resource templates. The `{instance}` parameter matches the MMKV instance name registered by the app adapter.

### 4c) Resource error handling

Resources that cannot be read (adapter not connected, stream unavailable) return an MCP error response with the appropriate error code from §5.

---

## 5) Error Contract

All tool and resource errors return structured responses. Tool errors use MCP's `isError: true` flag with structured JSON content.

### Error codes

| Code | Meaning | HTTP-analogous |
|---|---|---|
| `NOT_CONNECTED` | No app adapter is currently connected via WebSocket | 503 |
| `STREAM_UNAVAILABLE` | The requested stream is not active on the connected adapter | 404 |
| `TIMEOUT` | The adapter did not respond within the configured timeout | 504 |
| `PAYLOAD_TOO_LARGE` | Response payload exceeds the configured size limit | 413 |
| `PATH_NOT_FOUND` | The requested dot-notation path doesn't exist in the state tree | 404 |
| `SCOPE_NOT_FOUND` | The requested scope doesn't exist in the snapshot | 404 |
| `SNAPSHOT_NOT_FOUND` | The requested sequence number doesn't correspond to a snapshot | 404 |
| `INVALID_PARAMS` | Tool parameters failed Zod validation | 400 |

### Error response shape

```typescript
interface ToolErrorResponse {
  error: true
  code: string        // One of the codes above
  message: string     // Human-readable description
  details?: Record<string, unknown>
}
```

Tool handlers return this as a JSON-serialized `text` content item with `isError: true`:

```typescript
return {
  isError: true,
  content: [{
    type: 'text',
    text: JSON.stringify({ error: true, code: 'NOT_CONNECTED', message: '...' })
  }]
}
```

---

## 6) Configuration

The MCP server is configured via environment variables. All values have sensible defaults.

| Variable | Type | Default | Description |
|---|---|---|---|
| `WS_PORT` | `number` | `19850` | Port for the WebSocket server (app adapter connects here) |
| `WS_HOST` | `string` | `127.0.0.1` | Host to bind the WebSocket server to |
| `REQUEST_TIMEOUT_MS` | `number` | `5000` | Timeout for requests sent to the app adapter |
| `MAX_PAYLOAD_SIZE` | `number` | `524288` (512 KB) | Max WebSocket message size in bytes |
| `LOG_LEVEL` | `string` | `info` | Log verbosity: `debug`, `info`, `warn`, `error` |

### Configuration loading

Configuration is loaded once at startup from `process.env`, validated with Zod, and frozen. No hot-reloading.

```typescript
const ConfigSchema = z.object({
  WS_PORT: z.coerce.number().default(19850),
  WS_HOST: z.string().default('127.0.0.1'),
  REQUEST_TIMEOUT_MS: z.coerce.number().default(5000),
  MAX_PAYLOAD_SIZE: z.coerce.number().default(524_288),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
})
```

---

## 7) Project Structure

```
devtools-mcp/
├── src/
│   ├── index.ts                  # Entry point: parse config, start server
│   ├── server.ts                 # McpServer setup: tool + resource registration
│   ├── ws/
│   │   ├── server.ts             # WebSocket server (ws library)
│   │   └── connection-manager.ts # Track connected adapters, route requests
│   ├── tools/
│   │   ├── health-check.ts       # debug_health_check handler
│   │   ├── list-streams.ts       # debug_list_streams handler
│   │   ├── get-snapshot.ts       # debug_get_snapshot handler
│   │   ├── query-events.ts       # debug_query_events handler
│   │   ├── get-state-path.ts     # debug_get_state_path handler
│   │   └── diff-snapshots.ts     # debug_diff_snapshots handler
│   ├── resources/
│   │   ├── session.ts            # debug://session/current
│   │   ├── redux-state.ts        # debug://redux/state
│   │   └── navigation-state.ts   # debug://navigation/state
│   ├── types/
│   │   ├── debug-event.ts        # DebugEvent envelope type + Zod schema
│   │   ├── errors.ts             # Error codes, error response builder
│   │   ├── config.ts             # Config schema + loader
│   │   └── wire-protocol.ts      # Wire protocol message types (shared with adapter)
│   └── utils/
│       ├── logger.ts             # Structured logger (respects LOG_LEVEL)
│       └── json-path.ts          # Dot-notation path resolver for state trees
├── tests/
│   ├── unit/
│   │   ├── config.test.ts
│   │   ├── connection-manager.test.ts
│   │   ├── errors.test.ts
│   │   ├── json-path.test.ts
│   │   └── tools/
│   │       ├── health-check.test.ts
│   │       ├── list-streams.test.ts
│   │       ├── get-snapshot.test.ts
│   │       ├── query-events.test.ts
│   │       ├── get-state-path.test.ts
│   │       └── diff-snapshots.test.ts
│   ├── integration/
│   │   ├── ws-connection.test.ts
│   │   ├── tool-roundtrip.test.ts
│   │   └── resource-roundtrip.test.ts
│   └── helpers/
│       ├── mock-adapter.ts       # Simulates an in-app adapter over WebSocket
│       └── fixtures.ts           # Sample DebugEvent payloads
├── package.json
├── tsconfig.json
├── eslint.config.ts
├── vitest.config.ts
├── .editorconfig
├── AGENTS.md
├── README.md
└── docs/
    ├── Debug Data Adapter and MCP Server Specification.md
    ├── Development Tools MCP Research Report.md
    └── agent-devtools-mcp.spec.md  (this file)
```

---

## 8) Dependency Manifest

### Runtime dependencies

| Package | Version | Purpose |
|---|---|---|
| `@modelcontextprotocol/sdk` | `^1.26.0` | MCP protocol implementation (server + stdio transport) |
| `zod` | `^3.24` | Schema validation for tool inputs, config, wire protocol messages |
| `ws` | `^8.18` | WebSocket server |

### Dev dependencies

| Package | Version | Purpose |
|---|---|---|
| `typescript` | `^5.7` | Language |
| `vitest` | `^3.0` | Test framework |
| `eslint` | `^9.0` | Linting |
| `@types/ws` | `^8.18` | WebSocket type definitions |

### Runtime

- **Bun** `>=1.3.5` or **Node.js** `>=22` (Bun preferred, per project convention).

---

## 9) Server Lifecycle

### Startup sequence

1. Load and validate configuration from environment variables (§6).
2. Create the `ConnectionManager` instance.
3. Start the WebSocket server on `WS_HOST:WS_PORT`.
4. Create the `McpServer` instance, register all tools (§3) and resources (§4).
5. Create `StdioServerTransport` and connect the MCP server to it.
6. Log startup summary: WebSocket endpoint, registered tools/resources, server version.

### Shutdown sequence

1. On `SIGINT` / `SIGTERM`:
   a. Close all WebSocket connections gracefully.
   b. Close the WebSocket server.
   c. Close the MCP transport.
   d. Exit process with code 0.

### Adapter connection lifecycle

1. App adapter connects to WebSocket server.
2. Adapter sends handshake message (per wire protocol).
3. `ConnectionManager` validates handshake and registers the adapter.
4. MCP tools/resources are now functional (they route through `ConnectionManager`).
5. On disconnect, `ConnectionManager` removes the adapter. Tools return `NOT_CONNECTED` errors.
6. Only **one adapter connection at a time** is supported in v1. A new connection replaces the existing one.

---

## 10) Testing Strategy

### Test framework

**vitest** — consistent with modern TypeScript projects, fast, native ESM support.

### Unit tests

Each module is tested in isolation with mocked dependencies.

| Module | Key assertions |
|---|---|
| `config.ts` | Validates defaults, env overrides, invalid values rejected |
| `connection-manager.ts` | Tracks connections, routes requests, handles disconnects, enforces single-connection |
| `errors.ts` | Error builder produces correct shapes for each code |
| `json-path.ts` | Resolves dot-notation paths, handles missing paths, edge cases (arrays, nulls) |
| Each tool handler | Correct output for connected/disconnected states, parameter validation, error responses |

### Integration tests

Use a `mock-adapter` helper that simulates an in-app adapter over a real WebSocket connection.

| Test | Scenario |
|---|---|
| `ws-connection.test.ts` | Adapter connects, handshake validated, disconnect handled |
| `tool-roundtrip.test.ts` | MCP tool call → WebSocket request → mock adapter response → MCP result |
| `resource-roundtrip.test.ts` | MCP resource read → WebSocket request → mock adapter response → MCP resource content |

### Contract tests

- `DebugEvent` Zod schema validates sample payloads from all stream types.
- Tool input schemas reject malformed parameters.
- Tool output shapes conform to the documented response types.

---

## 11) Implementation Work Phases

This section defines the fine-grained, dependency-ordered task breakdown for AI agent execution. Each task specifies the files to create/modify, what the task produces, and what it depends on.

### Legend

- **ID**: Unique task identifier (used for dependency tracking).
- **Depends on**: Task IDs that must be completed first.
- **Produces**: Files created or modified.
- **Acceptance**: How to verify the task is done.

---

### Phase 1 — Project Scaffolding

#### Task `scaffold-init`

**Title**: Initialize project with package.json, tsconfig, and config files.

**Description**: Set up the project root with `package.json` (bun-only enforcement via `packageManager` field), `tsconfig.json` (strict mode, ESM, Node types), `.editorconfig` (matching existing), and `eslint.config.ts` (matching project conventions). Install runtime and dev dependencies.

**Depends on**: Nothing.

**Produces**: `package.json`, `tsconfig.json`, `eslint.config.ts`, `.editorconfig`, `bun.lock`

**Acceptance**: `bun install` succeeds. `bun run lint` runs without config errors (no source files to lint yet is OK).

---

#### Task `scaffold-vitest`

**Title**: Configure vitest.

**Description**: Add `vitest.config.ts` with TypeScript support, path aliases matching `tsconfig.json`, and a test file glob pattern (`tests/**/*.test.ts`). Add `test` script to `package.json`.

**Depends on**: `scaffold-init`

**Produces**: `vitest.config.ts`, updated `package.json` (scripts)

**Acceptance**: `bun run test` runs (0 tests found is OK at this stage).

---

#### Task `scaffold-src-dirs`

**Title**: Create source directory structure.

**Description**: Create the directory tree defined in §7: `src/`, `src/ws/`, `src/tools/`, `src/resources/`, `src/types/`, `src/utils/`, `tests/unit/`, `tests/unit/tools/`, `tests/integration/`, `tests/helpers/`. Create minimal placeholder `src/index.ts` that logs "server not yet implemented".

**Depends on**: `scaffold-init`

**Produces**: Directory tree, `src/index.ts` placeholder.

**Acceptance**: `bun run src/index.ts` prints the placeholder message.

---

### Phase 2 — Core Types and Utilities

#### Task `types-config`

**Title**: Implement configuration schema and loader.

**Description**: Create `src/types/config.ts` with the `ConfigSchema` Zod object (§6), a `loadConfig()` function that reads `process.env` and returns a frozen, validated config object, and the `Config` type exported from the schema. Write unit tests in `tests/unit/config.test.ts` covering: defaults applied when env vars absent, env var overrides work, invalid values (non-numeric port, invalid log level) throw `ZodError`.

**Depends on**: `scaffold-src-dirs`

**Produces**: `src/types/config.ts`, `tests/unit/config.test.ts`

**Acceptance**: `bun run test tests/unit/config.test.ts` — all tests pass.

---

#### Task `types-errors`

**Title**: Implement error codes and error response builder.

**Description**: Create `src/types/errors.ts` with: an `ErrorCode` string union type matching §5, a `ToolErrorResponse` interface, a `buildToolError(code, message, details?)` function that returns a MCP-compliant `CallToolResult` with `isError: true`, and a `createToolError(code, message, details?)` shorthand. Write unit tests in `tests/unit/errors.test.ts` verifying each error code produces the correct shape.

**Depends on**: `scaffold-src-dirs`

**Produces**: `src/types/errors.ts`, `tests/unit/errors.test.ts`

**Acceptance**: `bun run test tests/unit/errors.test.ts` — all tests pass.

---

#### Task `types-debug-event`

**Title**: Define DebugEvent envelope type and Zod schema.

**Description**: Create `src/types/debug-event.ts` with: the `DebugEvent` TypeScript interface matching the parent spec §5 envelope schema, a `DebugEventSchema` Zod object for runtime validation, and the stream-specific event type unions. This module is used for validating data received from the app adapter.

**Depends on**: `scaffold-src-dirs`

**Produces**: `src/types/debug-event.ts`

**Acceptance**: Lint passes. Types compile without errors.

---

#### Task `types-wire-protocol`

**Title**: Define wire protocol message types.

**Description**: Create `src/types/wire-protocol.ts` with TypeScript types for the wire protocol messages the MCP server sends and receives. This includes: `HandshakeMessage` (received from adapter on connect), `RequestMessage` (sent to adapter), `ResponseMessage` (received from adapter), `PushEventMessage` (received from adapter). Include Zod schemas for incoming messages. These types are the MCP server's view of the wire protocol — the full wire protocol spec is a separate document.

**Depends on**: `scaffold-src-dirs`, `types-debug-event`

**Produces**: `src/types/wire-protocol.ts`

**Acceptance**: Lint passes. Types compile without errors.

---

#### Task `util-logger`

**Title**: Implement structured logger.

**Description**: Create `src/utils/logger.ts` with a minimal structured logger that respects the `LOG_LEVEL` config. Use `console.error` for output (keeps stdout clean for stdio MCP transport). Export a `createLogger(config)` function that returns an object with `debug`, `info`, `warn`, `error` methods. Each method outputs JSON-structured log lines to stderr.

**Depends on**: `types-config`

**Produces**: `src/utils/logger.ts`

**Acceptance**: Lint passes. Logger output goes to stderr, not stdout.

---

#### Task `util-json-path`

**Title**: Implement dot-notation JSON path resolver.

**Description**: Create `src/utils/json-path.ts` with a `resolveJsonPath(obj, path)` function that traverses an object by dot-notation path (e.g., `"auth.user.role"`) and returns the value or `undefined`. Handle edge cases: empty path (returns root), array indices (e.g., `"routes.0.name"`), null/undefined intermediate values. Write unit tests in `tests/unit/json-path.test.ts`.

**Depends on**: `scaffold-src-dirs`

**Produces**: `src/utils/json-path.ts`, `tests/unit/json-path.test.ts`

**Acceptance**: `bun run test tests/unit/json-path.test.ts` — all tests pass.

---

### Phase 3 — WebSocket Server and Connection Management

#### Task `ws-server`

**Title**: Implement WebSocket server.

**Description**: Create `src/ws/server.ts` that exports a `createWsServer(config, connectionManager)` function. It creates a `ws.WebSocketServer` bound to `config.WS_HOST:config.WS_PORT`. On new connections, it delegates to the `ConnectionManager`. It respects `config.MAX_PAYLOAD_SIZE` as the max message size. The function returns a handle with `close()` for graceful shutdown.

**Depends on**: `types-config`, `ws-connection-manager`

**Produces**: `src/ws/server.ts`

**Acceptance**: Lint passes. Types compile.

---

#### Task `ws-connection-manager`

**Title**: Implement connection manager.

**Description**: Create `src/ws/connection-manager.ts` with a `ConnectionManager` class that: tracks the currently connected adapter (single connection, v1), validates handshake messages using the wire protocol Zod schema, provides `isConnected()` / `getAdapterInfo()` methods, implements a `request(type, params)` method that sends a request to the adapter over WebSocket and returns a Promise that resolves with the response (or rejects on timeout per `REQUEST_TIMEOUT_MS`), handles adapter disconnect (clears state, logs). Write unit tests in `tests/unit/connection-manager.test.ts` using a mock WebSocket.

**Depends on**: `types-config`, `types-wire-protocol`, `util-logger`

**Produces**: `src/ws/connection-manager.ts`, `tests/unit/connection-manager.test.ts`

**Acceptance**: `bun run test tests/unit/connection-manager.test.ts` — all tests pass.

---

### Phase 4 — Test Helpers

#### Task `test-mock-adapter`

**Title**: Create mock adapter test helper.

**Description**: Create `tests/helpers/mock-adapter.ts` — a class that simulates an in-app debug adapter. It connects to the MCP server's WebSocket, sends a valid handshake, responds to requests with configurable payloads, and can simulate push events. This is the primary test utility for integration tests.

**Depends on**: `types-wire-protocol`, `types-debug-event`

**Produces**: `tests/helpers/mock-adapter.ts`

**Acceptance**: Lint passes. Types compile.

---

#### Task `test-fixtures`

**Title**: Create test fixtures.

**Description**: Create `tests/helpers/fixtures.ts` with sample `DebugEvent` payloads for each stream type (Redux `action_dispatched`, `state_snapshot`; Navigation `route_change`, `navigation_snapshot`). Include sample state trees for `json-path` and `diff` testing.

**Depends on**: `types-debug-event`

**Produces**: `tests/helpers/fixtures.ts`

**Acceptance**: Lint passes. Fixtures conform to `DebugEventSchema`.

---

### Phase 5 — MCP Tool Handlers

#### Task `tool-health-check`

**Title**: Implement `debug_health_check` tool.

**Description**: Create `src/tools/health-check.ts` that exports a tool handler function. It queries `ConnectionManager` for connection status and adapter info, queries stream metadata, and returns the response shape from §3a. Write unit tests in `tests/unit/tools/health-check.test.ts` for connected and disconnected scenarios.

**Depends on**: `ws-connection-manager`, `types-errors`

**Produces**: `src/tools/health-check.ts`, `tests/unit/tools/health-check.test.ts`

**Acceptance**: `bun run test tests/unit/tools/health-check.test.ts` — all tests pass.

---

#### Task `tool-list-streams`

**Title**: Implement `debug_list_streams` tool.

**Description**: Create `src/tools/list-streams.ts` per §3b. Sends a request to the adapter via `ConnectionManager.request()` to get stream metadata. Returns error if not connected. Write unit tests.

**Depends on**: `ws-connection-manager`, `types-errors`

**Produces**: `src/tools/list-streams.ts`, `tests/unit/tools/list-streams.test.ts`

**Acceptance**: Unit tests pass.

---

#### Task `tool-get-snapshot`

**Title**: Implement `debug_get_snapshot` tool.

**Description**: Create `src/tools/get-snapshot.ts` per §3c. Accepts `stream` and optional `scope` parameters. Sends request to adapter, applies scope filtering using `resolveJsonPath` if provided. Handles all error cases. Write unit tests.

**Depends on**: `ws-connection-manager`, `types-errors`, `util-json-path`

**Produces**: `src/tools/get-snapshot.ts`, `tests/unit/tools/get-snapshot.test.ts`

**Acceptance**: Unit tests pass.

---

#### Task `tool-query-events`

**Title**: Implement `debug_query_events` tool.

**Description**: Create `src/tools/query-events.ts` per §3d. Validates and clamps `limit` parameter. Sends request with filters to adapter. Returns paginated event list. Write unit tests.

**Depends on**: `ws-connection-manager`, `types-errors`, `types-debug-event`

**Produces**: `src/tools/query-events.ts`, `tests/unit/tools/query-events.test.ts`

**Acceptance**: Unit tests pass.

---

#### Task `tool-get-state-path`

**Title**: Implement `debug_get_state_path` tool.

**Description**: Create `src/tools/get-state-path.ts` per §3e. Requests full Redux state snapshot from adapter, resolves the dot-notation path using `resolveJsonPath`, returns the value. Handles `PATH_NOT_FOUND`. Write unit tests.

**Depends on**: `ws-connection-manager`, `types-errors`, `util-json-path`

**Produces**: `src/tools/get-state-path.ts`, `tests/unit/tools/get-state-path.test.ts`

**Acceptance**: Unit tests pass.

---

#### Task `tool-diff-snapshots`

**Title**: Implement `debug_diff_snapshots` tool.

**Description**: Create `src/tools/diff-snapshots.ts` per §3f. Requests two snapshots by sequence number from the adapter, computes a structural diff (added/removed/changed keys), returns the diff. Implement the diff algorithm in the tool handler itself (simple recursive object comparison — no external diff library). Write unit tests.

**Depends on**: `ws-connection-manager`, `types-errors`

**Produces**: `src/tools/diff-snapshots.ts`, `tests/unit/tools/diff-snapshots.test.ts`

**Acceptance**: Unit tests pass.

---

### Phase 6 — MCP Resource Handlers

#### Task `resource-session`

**Title**: Implement `debug://session/current` resource.

**Description**: Create `src/resources/session.ts` that registers a static MCP resource. When read, it queries `ConnectionManager` for adapter info and returns session metadata. Returns error if not connected.

**Depends on**: `ws-connection-manager`, `types-errors`

**Produces**: `src/resources/session.ts`

**Acceptance**: Lint passes. Types compile.

---

#### Task `resource-redux-state`

**Title**: Implement `debug://redux/state` resource.

**Description**: Create `src/resources/redux-state.ts` that registers a static MCP resource. When read, requests the latest Redux state snapshot from the adapter and returns it as JSON text content.

**Depends on**: `ws-connection-manager`, `types-errors`

**Produces**: `src/resources/redux-state.ts`

**Acceptance**: Lint passes. Types compile.

---

#### Task `resource-navigation-state`

**Title**: Implement `debug://navigation/state` resource.

**Description**: Create `src/resources/navigation-state.ts` that registers a static MCP resource for the latest navigation state.

**Depends on**: `ws-connection-manager`, `types-errors`

**Produces**: `src/resources/navigation-state.ts`

**Acceptance**: Lint passes. Types compile.

---

### Phase 7 — Server Assembly and Entry Point

#### Task `server-assembly`

**Title**: Assemble MCP server with all tools and resources.

**Description**: Create `src/server.ts` that exports a `createMcpServer(connectionManager)` function. It instantiates `McpServer` from `@modelcontextprotocol/sdk`, registers all 6 tools (§3) with their Zod input schemas and handler functions, and registers all 3 resources (§4). Returns the configured `McpServer` instance.

**Depends on**: All `tool-*` tasks, all `resource-*` tasks.

**Produces**: `src/server.ts`

**Acceptance**: Lint passes. Types compile.

---

#### Task `entry-point`

**Title**: Implement main entry point.

**Description**: Update `src/index.ts` to implement the full startup sequence (§9): load config, create `ConnectionManager`, start WebSocket server, create MCP server, connect to `StdioServerTransport`, register shutdown handlers (`SIGINT`, `SIGTERM`). This is the runnable entry point.

**Depends on**: `server-assembly`, `ws-server`, `types-config`, `util-logger`

**Produces**: `src/index.ts` (updated)

**Acceptance**: `bun run src/index.ts` starts the server, logs startup info to stderr, WebSocket server is listening.

---

### Phase 8 — Integration Tests

#### Task `integration-ws-connection`

**Title**: Write WebSocket connection integration tests.

**Description**: Create `tests/integration/ws-connection.test.ts`. Start the real WebSocket server, connect the mock adapter, verify handshake is validated, verify disconnect is handled, verify that a second connection replaces the first.

**Depends on**: `entry-point`, `test-mock-adapter`

**Produces**: `tests/integration/ws-connection.test.ts`

**Acceptance**: `bun run test tests/integration/ws-connection.test.ts` — all tests pass.

---

#### Task `integration-tool-roundtrip`

**Title**: Write MCP tool roundtrip integration tests.

**Description**: Create `tests/integration/tool-roundtrip.test.ts`. Start the full server (WebSocket + MCP), connect mock adapter, invoke each MCP tool via the MCP SDK client, verify the round-trip: tool call → WebSocket request → mock adapter response → MCP result. Test at least: `debug_health_check` (connected), `debug_get_snapshot` (with mock Redux state), `debug_query_events` (with mock events), and a disconnected-adapter error case.

**Depends on**: `entry-point`, `test-mock-adapter`, `test-fixtures`

**Produces**: `tests/integration/tool-roundtrip.test.ts`

**Acceptance**: `bun run test tests/integration/tool-roundtrip.test.ts` — all tests pass.

---

#### Task `integration-resource-roundtrip`

**Title**: Write MCP resource roundtrip integration tests.

**Description**: Create `tests/integration/resource-roundtrip.test.ts`. Similar to tool roundtrip but for resources. Connect mock adapter, read each resource URI via MCP client, verify content matches mock adapter data.

**Depends on**: `entry-point`, `test-mock-adapter`, `test-fixtures`

**Produces**: `tests/integration/resource-roundtrip.test.ts`

**Acceptance**: `bun run test tests/integration/resource-roundtrip.test.ts` — all tests pass.

---

### Phase 9 — Documentation and Polish

#### Task `readme`

**Title**: Write README.md.

**Description**: Create `README.md` with: project overview, prerequisites (Bun/Node), installation, configuration (env vars table), usage with MCP clients (Copilot CLI, Claude Code, Cursor), available tools and resources summary, development setup (install, test, lint).

**Depends on**: `entry-point`

**Produces**: `README.md`

**Acceptance**: README is accurate and matches the implemented server.

---

#### Task `package-bin`

**Title**: Configure package.json bin entry.

**Description**: Add `bin` field to `package.json` pointing to the compiled entry point, so the server can be invoked directly (e.g., `npx agent-devtools-mcp`). Add a build script if needed for the bin entry.

**Depends on**: `entry-point`

**Produces**: Updated `package.json`

**Acceptance**: `bun run build` (if applicable) succeeds. The bin entry resolves correctly.

---

### Deferred Phases

#### Phase D1 — MMKV Stream Support (Phase 3 per parent spec)

**Task `resource-mmkv`**: Add `debug://mmkv/{instance}` resource template. Depends on MMKV collector being available in the app adapter.

**Task `tool-mmkv-events`**: Extend `debug_query_events` and `debug_get_snapshot` to support `stream: 'mmkv'`. Primarily a wire protocol concern — the MCP server already supports the `'mmkv'` stream enum.

#### Phase D2 — Streamable HTTP Transport (Phase 4 per parent spec)

**Task `transport-http`**: Add Streamable HTTP as an alternative MCP transport. Configurable via env var (e.g., `MCP_TRANSPORT=http`). Uses `NodeStreamableHTTPServerTransport` from `@modelcontextprotocol/sdk` on port `3100`. The WebSocket server remains unchanged.

**Task `transport-http-tests`**: Integration tests for HTTP transport.

---

## 12) Task Dependency Graph

```text
scaffold-init
├── scaffold-vitest
├── scaffold-src-dirs
│   ├── types-config
│   │   ├── util-logger
│   │   └── ws-server ←────────────────────────────────────┐
│   ├── types-errors                                        │
│   │   ├── tool-health-check ←─── ws-connection-manager ──┤
│   │   ├── tool-list-streams ←─── ws-connection-manager    │
│   │   ├── tool-get-snapshot ←─── ws-connection-manager    │
│   │   │                    ←─── util-json-path            │
│   │   ├── tool-query-events ←── ws-connection-manager     │
│   │   ├── tool-get-state-path ← ws-connection-manager     │
│   │   │                    ←─── util-json-path            │
│   │   ├── tool-diff-snapshots ← ws-connection-manager     │
│   │   ├── resource-session ←─── ws-connection-manager     │
│   │   ├── resource-redux-state ← ws-connection-manager    │
│   │   └── resource-navigation-state ← ws-connection-manager
│   ├── types-debug-event                                   │
│   │   ├── types-wire-protocol                             │
│   │   │   ├── ws-connection-manager ──────────────────────┘
│   │   │   └── test-mock-adapter
│   │   └── test-fixtures
│   └── util-json-path
│
│  Assembly (after all tools + resources):
├── server-assembly → entry-point
│
│  Integration (after entry-point + test helpers):
├── integration-ws-connection
├── integration-tool-roundtrip
└── integration-resource-roundtrip
│
│  Polish (after entry-point):
├── readme
└── package-bin
```

---

## 13) References

- **Parent spec**: [Debug Data Adapter and MCP Server Specification](./Debug%20Data%20Adapter%20and%20MCP%20Server%20Specification.md)
- **MCP TypeScript SDK**: https://github.com/modelcontextprotocol/typescript-sdk (`@modelcontextprotocol/sdk` ^1.26.0)
- **MCP Architecture Concepts**: https://modelcontextprotocol.io/docs/concepts/architecture
- **Prior art (closest)**: https://github.com/fysnerd/expo-devtools-mcp
- **ws library**: https://github.com/websockets/ws
