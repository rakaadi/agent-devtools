# Agent DevTools MCP Server — Technical Specification

> **Version:** 1.1
> **Status:** Draft
> **Last Updated:** 2026-02-19
> **Parent Spec:** [Debug Data Adapter and MCP Server Specification](./Debug%20Data%20Adapter%20and%20MCP%20Server%20Specification.md)
> **Monorepo package:** `packages/server` (`@agent-devtools/server`)
> **Shared types package:** `packages/shared` (`@agent-devtools/shared`)

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
3. **Dev-only, defense-in-depth.** The server is a development tool that binds to `127.0.0.1` by default. Despite localhost-only binding, the server applies defense-in-depth: Origin header validation on WebSocket connections, DNS rebinding protection, prototype-pollution-safe path resolution, and configurable rate limiting on adapter requests. If `WS_HOST` is changed to a non-loopback address, the server logs a security warning at startup.
4. **Minimal dependencies.** Only add what's strictly necessary for the MCP protocol, WebSocket communication, and schema validation.
5. **Monorepo-aware.** This server is the `@agent-devtools/server` package within a Bun workspace monorepo. Shared types (wire protocol messages, `DebugEvent` envelope) live in `@agent-devtools/shared` and are imported — never duplicated.

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

All tools use structured JSON input validated with Zod schemas. All tools return MCP-compliant `CallToolResult` with both `content` arrays (text representation) and `structuredContent` (typed output for programmatic use). Each tool provides a `title`, comprehensive `description`, `inputSchema`, `outputSchema`, and `annotations`.

### Tool annotations reference

Every tool must declare annotations so MCP clients can reason about tool behavior:

| Annotation | Description |
|---|---|
| `readOnlyHint` | `true` if the tool does not modify any state |
| `destructiveHint` | `true` if the tool may perform destructive updates |
| `idempotentHint` | `true` if repeated calls with the same args have no additional effect |
| `openWorldHint` | `false` — all tools interact with a known, local debug adapter, not external entities |

### Response format convention

All tools that return data accept an optional `response_format` parameter (`'json' | 'markdown'`, default `'markdown'`). Markdown responses are optimized for agent context windows (human-readable headers, lists, formatted output). JSON responses include complete structured data. Regardless of `response_format`, `structuredContent` always contains the typed output object.

### Response size limit

A `CHARACTER_LIMIT` constant (default: `50_000` characters) caps the serialized text content of any tool response. If a response exceeds this limit, it is truncated with a clear message and a `truncated: true` field in `structuredContent`, along with guidance on using filters or pagination to retrieve the full data.

### 3a) `debug_health_check`

**Title**: "Debug Health Check"

**Purpose**: Check connection status and adapter capabilities.

**Parameters**: None.

**Annotations**: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`

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

**Title**: "List Debug Streams"

**Purpose**: List available data streams and their status.

**Parameters**: None.

**Annotations**: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`

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

**Title**: "Get Debug Snapshot"

**Purpose**: Retrieve the latest state snapshot for a given stream.

**Annotations**: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`

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

**Title**: "Query Debug Events"

**Purpose**: Query events from a stream's ring buffer with filtering and pagination.

**Annotations**: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`

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

**Title**: "Get State Path Value"

**Purpose**: Read a specific value from a stream's state tree by dot-notation path. This is a convenience shorthand over `debug_get_snapshot` with `scope` — it always targets the latest snapshot and returns only the resolved value.

**Annotations**: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`

**Parameters**:

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `stream` | `'redux' \| 'navigation'` | No | `'redux'` | Target stream |
| `path` | `string` | Yes | — | Dot-notation path (e.g., `"api.queries"`, `"auth.user.role"`, `"routes.0.name"`) |

**Returns**: The value at the specified path, JSON-serialized.

**Errors**:
- `NOT_CONNECTED`: No adapter connected.
- `STREAM_UNAVAILABLE`: Target stream not active.
- `PATH_NOT_FOUND`: The path does not resolve to a value in the current state.

### 3f) `debug_diff_snapshots`

**Title**: "Diff Debug Snapshots"

**Purpose**: Compute a structural diff between two snapshots of the same stream.

**Annotations**: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`

**Parameters**:

| Param | Type | Required | Description |
|---|---|---|---|
| `stream` | `'redux' \| 'navigation' \| 'mmkv'` | Yes | Target stream |
| `base_seq` | `number` | Yes | Sequence number of the base snapshot |
| `target_seq` | `number` | Yes | Sequence number of the target snapshot |
| `max_depth` | `number` | No | `10` | Maximum recursion depth for the diff algorithm (1–50). Deeper structures are reported as opaque `changed` entries. |
| `max_changes` | `number` | No | `500` | Maximum number of change entries to return (1–2000). If exceeded, the response includes `truncated: true`. |

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
  truncated: boolean         // True if max_changes was exceeded
  totalChanges: number       // Actual number of changes detected (may be > changes.length)
}
```

**Errors**:
- `NOT_CONNECTED`: No adapter connected.
- `STREAM_UNAVAILABLE`: Requested stream not active.
- `SNAPSHOT_NOT_FOUND`: One or both sequence numbers don't correspond to a snapshot in the buffer.

---

## 4) MCP Resource Surface

Resources provide read-only, URI-addressable access to current state. They are suitable for LLM context injection (e.g., "attach the current Redux state to this conversation").

> **Note:** The `debug://` URI scheme is a custom scheme specific to this MCP server. It does not conflict with standard MCP resource schemes (`file://`, `https://`, etc.).

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
| `ADAPTER_ERROR` | The connected adapter returned an error response | 502 |
| `INTERNAL_ERROR` | Unexpected server-side error (catch-all) | 500 |

### Error response shape

```typescript
interface ToolErrorResponse {
  code: string        // One of the codes above
  message: string     // Human-readable description with actionable guidance
  details?: Record<string, unknown>
}
```

Tool handlers return this as a JSON-serialized `text` content item with `isError: true`:

```typescript
return {
  isError: true,
  content: [{
    type: 'text',
    text: JSON.stringify({ code: 'NOT_CONNECTED', message: 'No app adapter is connected. Start your React Native app with the debug adapter enabled, then retry.' })
  }]
}
```

---

## 6) Configuration

The MCP server is configured via environment variables. All values have sensible defaults.

| Variable | Type | Default | Description |
|---|---|---|---|
| `WS_PORT` | `number` | `19850` | Port for the WebSocket server (1–65535). App adapter connects here. |
| `WS_HOST` | `string` | `127.0.0.1` | Host to bind the WebSocket server to. **Security:** Changing to `0.0.0.0` exposes the server to the network — a warning is logged at startup. |
| `REQUEST_TIMEOUT_MS` | `number` | `5000` | Timeout for requests sent to the app adapter (100–30000) |
| `MAX_PAYLOAD_SIZE` | `number` | `1_048_576` (1 MB) | Max WebSocket message size in bytes (1024–10_485_760) |
| `MAX_RESPONSE_CHARS` | `number` | `50_000` | Max character count for serialized tool response text content (1000–200_000). Responses exceeding this are truncated. |
| `LOG_LEVEL` | `string` | `info` | Log verbosity: `debug`, `info`, `warn`, `error` |

### Configuration loading

Configuration is loaded once at startup from `process.env`, validated with Zod, and frozen. No hot-reloading.

```typescript
const ConfigSchema = z.object({
  WS_PORT: z.coerce.number().int().min(1).max(65535).default(19850),
  WS_HOST: z.string().default('127.0.0.1'),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(5000),
  MAX_PAYLOAD_SIZE: z.coerce.number().int().min(1024).max(10_485_760).default(1_048_576),
  MAX_RESPONSE_CHARS: z.coerce.number().int().min(1000).max(200_000).default(50_000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
})
```

### Security hardening

Even though this is a dev-only tool, the server applies defense-in-depth measures:

1. **DNS rebinding protection**: The WebSocket server validates the `Host` header on incoming upgrade requests. Only `localhost`, `127.0.0.1`, `[::1]`, and the configured `WS_HOST` are accepted. Requests with other `Host` values are rejected with HTTP 403.

2. **Origin validation**: The WebSocket server validates the `Origin` header on upgrade requests. Only requests without an `Origin` (local CLI tools) or with `Origin` matching the allowed hosts above are accepted.

3. **Non-loopback warning**: If `WS_HOST` is set to a non-loopback address (anything other than `127.0.0.1`, `::1`, or `localhost`), the server logs a `warn`-level message at startup: `"WebSocket server bound to non-loopback address — debug data is exposed to the network."`.

4. **Prototype pollution prevention**: The `resolveJsonPath` utility rejects path segments that match `__proto__`, `constructor`, or `prototype`. These paths return `PATH_NOT_FOUND`.

5. **Message validation**: All incoming WebSocket messages are validated against the wire protocol Zod schemas. Malformed messages are logged and discarded — they do not crash the server or propagate errors to MCP clients.

6. **Payload size enforcement**: The WebSocket server enforces `MAX_PAYLOAD_SIZE` at the `ws` library level. Messages exceeding this limit are dropped and the connection is closed.

---

## 7) Project Structure

The MCP server lives in `packages/server/` within the monorepo. Shared types (wire protocol, DebugEvent) live in `packages/shared/` and are imported via the `@agent-devtools/shared` workspace dependency.

```
packages/server/                      # @agent-devtools/server
├── src/
│   ├── index.ts                      # Entry point: parse config, start server
│   ├── server.ts                     # McpServer setup: tool + resource registration
│   ├── ws/
│   │   ├── server.ts                 # WebSocket server (ws library)
│   │   └── connection-manager.ts     # Track connected adapters, route requests
│   ├── tools/
│   │   ├── health-check.ts           # debug_health_check handler
│   │   ├── list-streams.ts           # debug_list_streams handler
│   │   ├── get-snapshot.ts           # debug_get_snapshot handler
│   │   ├── query-events.ts           # debug_query_events handler
│   │   ├── get-state-path.ts         # debug_get_state_path handler
│   │   └── diff-snapshots.ts         # debug_diff_snapshots handler
│   ├── resources/
│   │   ├── session.ts                # debug://session/current
│   │   ├── redux-state.ts            # debug://redux/state
│   │   └── navigation-state.ts      # debug://navigation/state
│   ├── types/
│   │   ├── errors.ts                 # Error codes, error response builder
│   │   └── config.ts                 # Config schema + loader
│   └── utils/
│       ├── logger.ts                 # Structured logger (respects LOG_LEVEL)
│       └── json-path.ts             # Dot-notation path resolver for state trees
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
│       ├── mock-adapter.ts           # Simulates an in-app adapter over WebSocket
│       └── fixtures.ts               # Sample DebugEvent payloads
├── package.json
├── tsconfig.json
├── tsconfig.build.json
└── vitest.config.ts

packages/shared/                      # @agent-devtools/shared (already exists)
├── src/
│   ├── index.ts                      # Re-exports all shared types
│   ├── streams.ts                    # StreamName type, event type unions per stream
│   ├── debug-event.ts                # DebugEvent envelope type + Zod schema
│   └── wire-protocol.ts             # Wire protocol message types + Zod schemas
├── package.json
└── tsconfig.json
```

**Note:** `types/debug-event.ts` and `types/wire-protocol.ts` from the original flat structure now live in `@agent-devtools/shared`. The server imports them — it does not duplicate them.

---

## 8) Dependency Manifest

### Runtime dependencies

| Package | Version | Purpose |
|---|---|---|
| `@agent-devtools/shared` | `workspace:*` | Shared types: DebugEvent envelope, wire protocol messages, Zod schemas |
| `@modelcontextprotocol/sdk` | `^1.26.0` | MCP protocol implementation (server + stdio transport) |
| `zod` | `^3.24` | Schema validation for tool inputs, config |
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
2. WebSocket server validates `Host` and `Origin` headers (§6 security hardening). Rejects with HTTP 403 if validation fails.
3. Adapter sends handshake message (per wire protocol).
4. `ConnectionManager` validates handshake using wire protocol Zod schemas and registers the adapter.
5. MCP tools/resources are now functional (they route through `ConnectionManager`).
6. On disconnect, `ConnectionManager` removes the adapter. Tools return `NOT_CONNECTED` errors.
7. Only **one adapter connection at a time** is supported in v1. A new connection replaces the existing one: all in-flight requests to the old adapter are rejected with `TIMEOUT`, the old WebSocket is closed with code `4001` ("replaced by new connection"), and the new adapter proceeds through the handshake flow.
8. If the adapter sends a malformed message (fails Zod validation), the message is logged at `warn` level and discarded. The connection remains open — a single bad message does not terminate the session.

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
| `ws-connection.test.ts` | Adapter connects, handshake validated, disconnect handled, connection replacement rejects in-flight requests |
| `tool-roundtrip.test.ts` | MCP tool call → WebSocket request → mock adapter response → MCP result |
| `resource-roundtrip.test.ts` | MCP resource read → WebSocket request → mock adapter response → MCP resource content |

### Contract tests

- `DebugEvent` Zod schema validates sample payloads from all stream types.
- Wire protocol message schemas validate handshake, request, response, and push event payloads.
- Tool input schemas reject malformed parameters.
- Tool output shapes conform to the documented response types.

### Security tests

- WebSocket server rejects connections with invalid `Host` header.
- WebSocket server rejects connections with disallowed `Origin`.
- `resolveJsonPath` rejects prototype-polluting path segments (`__proto__`, `constructor`, `prototype`).
- Oversized WebSocket messages are dropped, connection closed.

---

## 11) Implementation Work Phases

This section defines the fine-grained, dependency-ordered task breakdown for AI agent execution. Each task specifies the files to create/modify, what the task produces, and what it depends on.

All tasks that produce both implementation code and tests follow a **strict Test-Driven Development (TDD)** workflow. These tasks are split into two sub-tasks:

- **Red (`-red`)**: Write the test first. The test defines the expected public interface and observable behaviour. The acceptance criterion is that the test **fails** because the implementation does not exist yet — not because of syntax or configuration errors.
- **Green (`-green`)**: Write the minimal implementation code to make the failing test pass, then refactor while keeping tests green. The acceptance criterion is that **all** tests pass and no previously passing tests are broken.

Tasks are always executed as **vertical slices**: one Red → one Green → repeat. Never batch all Red tasks before starting Green tasks.

### Legend

- **ID**: Unique task identifier (used for dependency tracking). Suffixed with `-red` or `-green` for TDD sub-tasks.
- **Depends on**: Task IDs that must be completed first.
- **Produces**: Files created or modified.
- **Acceptance**: How to verify the task is done. For `-red` tasks, this is a test failure for the right reason. For `-green` tasks, this is all tests passing.

---

### Phase 1 — Project Scaffolding

> **Note:** The monorepo root (`package.json`, `.editorconfig`, `eslint.config.ts`) and the `packages/server/package.json` already exist. These tasks verify and augment the existing scaffolding rather than creating it from scratch.

#### Task `scaffold-init`

**Title**: Verify and finalize server package configuration.

**Description**: Verify `packages/server/package.json` has all required dependencies (§8), `tsconfig.json` and `tsconfig.build.json` are configured with strict mode and ESM. Ensure the `@agent-devtools/shared` workspace dependency is declared. Run `bun install` at the monorepo root to confirm dependency resolution.

**Depends on**: Nothing.

**Produces**: Verified/updated `packages/server/package.json`, `packages/server/tsconfig.json`

**Acceptance**: `bun install` succeeds at monorepo root. `bun run lint` runs without config errors.

---

#### Task `scaffold-vitest`

**Title**: Configure vitest.

**Description**: Add `vitest.config.ts` with TypeScript support, path aliases matching `tsconfig.json`, and a test file glob pattern (`tests/**/*.test.ts`). Add `test` script to `package.json`.

**Depends on**: `scaffold-init`

**Produces**: `packages/server/vitest.config.ts`, updated `packages/server/package.json` (scripts)

**Acceptance**: `bun run test` runs (0 tests found is OK at this stage).

---

#### Task `scaffold-src-dirs`

**Title**: Create source directory structure.

**Description**: Create the directory tree defined in §7 under `packages/server/`: `src/`, `src/ws/`, `src/tools/`, `src/resources/`, `src/types/`, `src/utils/`, `tests/unit/`, `tests/unit/tools/`, `tests/integration/`, `tests/helpers/`. Create minimal placeholder `src/index.ts` that logs "server not yet implemented".

**Depends on**: `scaffold-init`

**Produces**: Directory tree under `packages/server/`, `packages/server/src/index.ts` placeholder.

**Acceptance**: `bun run src/index.ts` prints the placeholder message.

---

### Phase 2 — Core Types and Utilities

#### Task `types-config-red`

**Title**: Write failing tests for configuration schema and loader.

**Description**: Write unit tests in `packages/server/tests/unit/config.test.ts` that define the expected behaviour of the configuration module. Tests should cover: defaults applied when env vars are absent, env var overrides work, range validation (port out of range, negative timeout) throws `ZodError`, and the `Config` type shape. Import from the not-yet-existing `../src/types/config.ts` — the tests must fail because the module does not exist.

**Depends on**: `scaffold-src-dirs`, `scaffold-vitest`

**Produces**: `packages/server/tests/unit/config.test.ts`

**Acceptance**: `bun run test tests/unit/config.test.ts` — tests **fail** because `config.ts` does not exist (import/module error), not because of test syntax errors.

---

#### Task `types-config-green`

**Title**: Implement configuration schema and loader to pass tests.

**Description**: Create `packages/server/src/types/config.ts` with the `ConfigSchema` Zod object (§6), a `loadConfig()` function that reads `process.env` and returns a frozen, validated config object (including the non-loopback warning check per §6 security hardening), and the `Config` type exported from the schema. Write the minimal code needed to make all `config.test.ts` tests pass. After tests are green, refactor for clarity (e.g., extract constants, improve naming) while keeping all tests passing.

**Depends on**: `types-config-red`

**Produces**: `packages/server/src/types/config.ts`

**Acceptance**: `bun run test tests/unit/config.test.ts` — all tests pass. No previously passing tests broken.

---

#### Task `types-errors-red`

**Title**: Write failing tests for error codes and error response builder.

**Description**: Write unit tests in `packages/server/tests/unit/errors.test.ts` that define the expected behaviour of the error module. Tests should verify: each `ErrorCode` value produces the correct `CallToolResult` shape with `isError: true`, `buildToolError` includes actionable guidance in messages, and `createToolError` shorthand works correctly. Import from the not-yet-existing `../src/types/errors.ts`.

**Depends on**: `scaffold-src-dirs`, `scaffold-vitest`

**Produces**: `packages/server/tests/unit/errors.test.ts`

**Acceptance**: `bun run test tests/unit/errors.test.ts` — tests **fail** because `errors.ts` does not exist (import/module error), not because of test syntax errors.

---

#### Task `types-errors-green`

**Title**: Implement error codes and error response builder to pass tests.

**Description**: Create `packages/server/src/types/errors.ts` with: an `ErrorCode` string union type matching §5 (including `ADAPTER_ERROR` and `INTERNAL_ERROR`), a `ToolErrorResponse` interface, a `buildToolError(code, message, details?)` function that returns a MCP-compliant `CallToolResult` with `isError: true`, and a `createToolError(code, message, details?)` shorthand. Error messages must include actionable guidance (e.g., "Start your React Native app with the debug adapter enabled, then retry."). Write the minimal code to make all `errors.test.ts` tests pass, then refactor while keeping tests green.

**Depends on**: `types-errors-red`

**Produces**: `packages/server/src/types/errors.ts`

**Acceptance**: `bun run test tests/unit/errors.test.ts` — all tests pass. No previously passing tests broken.

---

#### Task `types-debug-event`

**Title**: Define DebugEvent envelope type and Zod schema in shared package.

**Description**: Create or update `packages/shared/src/debug-event.ts` with: the `DebugEvent` TypeScript interface matching the parent spec §5 envelope schema, a `DebugEventSchema` Zod object for runtime validation, and the stream-specific event type unions. Re-export from `packages/shared/src/index.ts`. This module is used by both the server (for validating adapter data) and the adapter (for constructing events).

**Depends on**: `scaffold-src-dirs`

**Produces**: `packages/shared/src/debug-event.ts`, updated `packages/shared/src/index.ts`

**Acceptance**: Lint passes. Types compile without errors.

---

#### Task `types-wire-protocol`

**Title**: Define wire protocol message types in shared package.

**Description**: Create or update `packages/shared/src/wire-protocol.ts` with TypeScript types for the wire protocol messages the MCP server sends and receives. This includes: `HandshakeMessage` (received from adapter on connect), `RequestMessage` (sent to adapter), `ResponseMessage` (received from adapter), `PushEventMessage` (received from adapter). Include Zod schemas for incoming messages. Re-export from `packages/shared/src/index.ts`. These types are shared between `@agent-devtools/server` and `@agent-devtools/adapter` — the full wire protocol spec is a separate document.

**Depends on**: `scaffold-src-dirs`, `types-debug-event`

**Produces**: `packages/shared/src/wire-protocol.ts`, updated `packages/shared/src/index.ts`

**Acceptance**: Lint passes. Types compile without errors.

---

#### Task `util-logger`

**Title**: Implement structured logger.

**Description**: Create `packages/server/src/utils/logger.ts` with a minimal structured logger that respects the `LOG_LEVEL` config. Use `console.error` for output (keeps stdout clean for stdio MCP transport). Export a `createLogger(config)` function that returns an object with `debug`, `info`, `warn`, `error` methods. Each method outputs JSON-structured log lines to stderr with fields: `level`, `ts` (ISO 8601), `msg`, and optional `data`.

**Depends on**: `types-config-green`

**Produces**: `packages/server/src/utils/logger.ts`

**Acceptance**: Lint passes. Logger output goes to stderr, not stdout.

#### Task `util-json-path-red`

**Title**: Write failing tests for dot-notation JSON path resolver.

**Description**: Write unit tests in `packages/server/tests/unit/json-path.test.ts` that define the expected behaviour of `resolveJsonPath(obj, path)`. Tests should cover: traversing by dot-notation (e.g., `"auth.user.role"`), empty path returns root, array indices (e.g., `"routes.0.name"`), null/undefined intermediate values return `undefined`, and **security:** paths containing `__proto__`, `constructor`, or `prototype` segments return `undefined` (prototype pollution rejection). Import from the not-yet-existing `../src/utils/json-path.ts`.

**Depends on**: `scaffold-src-dirs`, `scaffold-vitest`

**Produces**: `packages/server/tests/unit/json-path.test.ts`

**Acceptance**: `bun run test tests/unit/json-path.test.ts` — tests **fail** because `json-path.ts` does not exist (import/module error), not because of test syntax errors.

---

#### Task `util-json-path-green`

**Title**: Implement dot-notation JSON path resolver to pass tests.

**Description**: Create `packages/server/src/utils/json-path.ts` with a `resolveJsonPath(obj, path)` function that traverses an object by dot-notation path and returns the value or `undefined`. Handle edge cases per the test expectations. Write the minimal code to make all `json-path.test.ts` tests pass, then refactor while keeping tests green.

**Depends on**: `util-json-path-red`

**Produces**: `packages/server/src/utils/json-path.ts`

**Acceptance**: `bun run test tests/unit/json-path.test.ts` — all tests pass. No previously passing tests broken.

---

### Phase 3 — WebSocket Server and Connection Management

#### Task `ws-server`

**Title**: Implement WebSocket server.

**Description**: Create `packages/server/src/ws/server.ts` that exports a `createWsServer(config, connectionManager, logger)` function. It creates a `ws.WebSocketServer` bound to `config.WS_HOST:config.WS_PORT`. On upgrade requests, validates `Host` and `Origin` headers per §6 security hardening before accepting the connection. On new connections, it delegates to the `ConnectionManager`. It respects `config.MAX_PAYLOAD_SIZE` as the max message size. The function returns a handle with `close()` for graceful shutdown.

**Depends on**: `types-config-green`, `ws-connection-manager-green`

**Produces**: `packages/server/src/ws/server.ts`

**Acceptance**: Lint passes. Types compile.

#### Task `ws-connection-manager-red`

**Title**: Write failing tests for connection manager.

**Description**: Write unit tests in `packages/server/tests/unit/connection-manager.test.ts` using a mock WebSocket that define the expected behaviour of the `ConnectionManager` class. Tests should cover: tracking a connected adapter (single connection, v1), validating handshake messages using the wire protocol Zod schema, `isConnected()` / `getAdapterInfo()` methods, `request(type, params)` method resolving with adapter response or rejecting on timeout per `REQUEST_TIMEOUT_MS`, adapter disconnect clearing state, connection replacement (rejecting in-flight requests, closing old connection with code `4001`), and discarding malformed incoming messages with a warning. Import from the not-yet-existing `../src/ws/connection-manager.ts`.

**Depends on**: `scaffold-vitest`, `types-config-green`, `types-wire-protocol`, `util-logger`

**Produces**: `packages/server/tests/unit/connection-manager.test.ts`

**Acceptance**: `bun run test tests/unit/connection-manager.test.ts` — tests **fail** because `connection-manager.ts` does not exist (import/module error), not because of test syntax errors.

---

#### Task `ws-connection-manager-green`

**Title**: Implement connection manager to pass tests.

**Description**: Create `packages/server/src/ws/connection-manager.ts` with a `ConnectionManager` class implementing all behaviours defined by the tests. Write the minimal code to make all `connection-manager.test.ts` tests pass, then refactor while keeping tests green.

**Depends on**: `ws-connection-manager-red`

**Produces**: `packages/server/src/ws/connection-manager.ts`

**Acceptance**: `bun run test tests/unit/connection-manager.test.ts` — all tests pass. No previously passing tests broken.

---

### Phase 4 — Test Helpers

#### Task `test-mock-adapter`

**Title**: Create mock adapter test helper.

**Description**: Create `packages/server/tests/helpers/mock-adapter.ts` — a class that simulates an in-app debug adapter. It connects to the MCP server's WebSocket, sends a valid handshake, responds to requests with configurable payloads, and can simulate push events. This is the primary test utility for integration tests.

**Depends on**: `types-wire-protocol`, `types-debug-event`

**Produces**: `packages/server/tests/helpers/mock-adapter.ts`

**Acceptance**: Lint passes. Types compile.

---

#### Task `test-fixtures`

**Title**: Create test fixtures.

**Description**: Create `packages/server/tests/helpers/fixtures.ts` with sample `DebugEvent` payloads for each stream type (Redux `action_dispatched`, `state_snapshot`; Navigation `route_change`, `navigation_snapshot`). Include sample state trees for `json-path` and `diff` testing.

**Depends on**: `types-debug-event`

**Produces**: `packages/server/tests/helpers/fixtures.ts`

**Acceptance**: Lint passes. Fixtures conform to `DebugEventSchema`.

---

### Phase 5 — MCP Tool Handlers

#### Task `tool-health-check-red`

**Title**: Write failing tests for `debug_health_check` tool.

**Description**: Write unit tests in `packages/server/tests/unit/tools/health-check.test.ts` that define the expected behaviour of the health check tool. Tests should cover: connected scenario (returns adapter info and stream metadata), disconnected scenario (returns appropriate status). Import from the not-yet-existing `../src/tools/health-check.ts`.

**Depends on**: `scaffold-vitest`, `ws-connection-manager-green`, `types-errors-green`

**Produces**: `packages/server/tests/unit/tools/health-check.test.ts`

**Acceptance**: `bun run test tests/unit/tools/health-check.test.ts` — tests **fail** because `health-check.ts` does not exist (import/module error), not because of test syntax errors.

---

#### Task `tool-health-check-green`

**Title**: Implement `debug_health_check` tool to pass tests.

**Description**: Create `packages/server/src/tools/health-check.ts` that exports a tool registration function. It queries `ConnectionManager` for connection status and adapter info, queries stream metadata, and returns the response shape from §3a. Register with `title`, `description`, `inputSchema`, `outputSchema`, and `annotations` per §3. Write the minimal code to make all tests pass, then refactor while keeping tests green.

**Depends on**: `tool-health-check-red`

**Produces**: `packages/server/src/tools/health-check.ts`

**Acceptance**: `bun run test tests/unit/tools/health-check.test.ts` — all tests pass. No previously passing tests broken.

---

#### Task `tool-list-streams-red`

**Title**: Write failing tests for `debug_list_streams` tool.

**Description**: Write unit tests in `packages/server/tests/unit/tools/list-streams.test.ts` that define the expected behaviour of the list streams tool per §3b. Tests should cover: successful stream metadata retrieval via `ConnectionManager.request()`, and error response when adapter is not connected. Import from the not-yet-existing `../src/tools/list-streams.ts`.

**Depends on**: `scaffold-vitest`, `ws-connection-manager-green`, `types-errors-green`

**Produces**: `packages/server/tests/unit/tools/list-streams.test.ts`

**Acceptance**: `bun run test tests/unit/tools/list-streams.test.ts` — tests **fail** because `list-streams.ts` does not exist (import/module error), not because of test syntax errors.

---

#### Task `tool-list-streams-green`

**Title**: Implement `debug_list_streams` tool to pass tests.

**Description**: Create `packages/server/src/tools/list-streams.ts` per §3b. Sends a request to the adapter via `ConnectionManager.request()` to get stream metadata. Returns error if not connected. Register with `title`, `annotations`, and `outputSchema`. Write the minimal code to make all tests pass, then refactor while keeping tests green.

**Depends on**: `tool-list-streams-red`

**Produces**: `packages/server/src/tools/list-streams.ts`

**Acceptance**: `bun run test tests/unit/tools/list-streams.test.ts` — all tests pass. No previously passing tests broken.

---

#### Task `tool-get-snapshot-red`

**Title**: Write failing tests for `debug_get_snapshot` tool.

**Description**: Write unit tests in `packages/server/tests/unit/tools/get-snapshot.test.ts` that define the expected behaviour of the get snapshot tool per §3c. Tests should cover: accepting `stream` and optional `scope` parameters, sending request to adapter, applying scope filtering using `resolveJsonPath` when provided, and handling all error cases. Import from the not-yet-existing `../src/tools/get-snapshot.ts`.

**Depends on**: `scaffold-vitest`, `ws-connection-manager-green`, `types-errors-green`, `util-json-path-green`

**Produces**: `packages/server/tests/unit/tools/get-snapshot.test.ts`

**Acceptance**: `bun run test tests/unit/tools/get-snapshot.test.ts` — tests **fail** because `get-snapshot.ts` does not exist (import/module error), not because of test syntax errors.

---

#### Task `tool-get-snapshot-green`

**Title**: Implement `debug_get_snapshot` tool to pass tests.

**Description**: Create `packages/server/src/tools/get-snapshot.ts` per §3c. Accepts `stream` and optional `scope` parameters. Sends request to adapter, applies scope filtering using `resolveJsonPath` if provided. Handles all error cases. Register with `title`, `annotations`, and `outputSchema`. Write the minimal code to make all tests pass, then refactor while keeping tests green.

**Depends on**: `tool-get-snapshot-red`

**Produces**: `packages/server/src/tools/get-snapshot.ts`

**Acceptance**: `bun run test tests/unit/tools/get-snapshot.test.ts` — all tests pass. No previously passing tests broken.

---

#### Task `tool-query-events-red`

**Title**: Write failing tests for `debug_query_events` tool.

**Description**: Write unit tests in `packages/server/tests/unit/tools/query-events.test.ts` that define the expected behaviour of the query events tool per §3d. Tests should cover: validating and clamping the `limit` parameter, sending request with filters to adapter, returning paginated event list, and applying `MAX_RESPONSE_CHARS` truncation. Import from the not-yet-existing `../src/tools/query-events.ts`.

**Depends on**: `scaffold-vitest`, `ws-connection-manager-green`, `types-errors-green`, `types-debug-event`

**Produces**: `packages/server/tests/unit/tools/query-events.test.ts`

**Acceptance**: `bun run test tests/unit/tools/query-events.test.ts` — tests **fail** because `query-events.ts` does not exist (import/module error), not because of test syntax errors.

---

#### Task `tool-query-events-green`

**Title**: Implement `debug_query_events` tool to pass tests.

**Description**: Create `packages/server/src/tools/query-events.ts` per §3d. Validates and clamps `limit` parameter. Sends request with filters to adapter. Returns paginated event list. Applies `MAX_RESPONSE_CHARS` truncation. Register with `title`, `annotations`, and `outputSchema`. Write the minimal code to make all tests pass, then refactor while keeping tests green.

**Depends on**: `tool-query-events-red`

**Produces**: `packages/server/src/tools/query-events.ts`

**Acceptance**: `bun run test tests/unit/tools/query-events.test.ts` — all tests pass. No previously passing tests broken.

---

#### Task `tool-get-state-path-red`

**Title**: Write failing tests for `debug_get_state_path` tool.

**Description**: Write unit tests in `packages/server/tests/unit/tools/get-state-path.test.ts` that define the expected behaviour of the get state path tool per §3e. Tests should cover: accepting optional `stream` parameter defaulting to `'redux'`, requesting latest state snapshot from adapter, resolving dot-notation path using `resolveJsonPath`, returning the value, and handling `PATH_NOT_FOUND`. Import from the not-yet-existing `../src/tools/get-state-path.ts`.

**Depends on**: `scaffold-vitest`, `ws-connection-manager-green`, `types-errors-green`, `util-json-path-green`

**Produces**: `packages/server/tests/unit/tools/get-state-path.test.ts`

**Acceptance**: `bun run test tests/unit/tools/get-state-path.test.ts` — tests **fail** because `get-state-path.ts` does not exist (import/module error), not because of test syntax errors.

---

#### Task `tool-get-state-path-green`

**Title**: Implement `debug_get_state_path` tool to pass tests.

**Description**: Create `packages/server/src/tools/get-state-path.ts` per §3e. Accepts optional `stream` parameter (defaults to `'redux'`). Requests the latest state snapshot from the adapter for the target stream, resolves the dot-notation path using `resolveJsonPath`, returns the value. Handles `PATH_NOT_FOUND`. Register with `title`, `annotations`, and `outputSchema`. Write the minimal code to make all tests pass, then refactor while keeping tests green.

**Depends on**: `tool-get-state-path-red`

**Produces**: `packages/server/src/tools/get-state-path.ts`

**Acceptance**: `bun run test tests/unit/tools/get-state-path.test.ts` — all tests pass. No previously passing tests broken.

---

#### Task `tool-diff-snapshots-red`

**Title**: Write failing tests for `debug_diff_snapshots` tool.

**Description**: Write unit tests in `packages/server/tests/unit/tools/diff-snapshots.test.ts` that define the expected behaviour of the diff snapshots tool per §3f. Tests should cover: requesting two snapshots by sequence number from the adapter, computing a structural diff (added/removed/changed keys), returning the diff, `max_depth` limiting recursion depth, and `max_changes` truncation behaviour. Import from the not-yet-existing `../src/tools/diff-snapshots.ts`.

**Depends on**: `scaffold-vitest`, `ws-connection-manager-green`, `types-errors-green`

**Produces**: `packages/server/tests/unit/tools/diff-snapshots.test.ts`

**Acceptance**: `bun run test tests/unit/tools/diff-snapshots.test.ts` — tests **fail** because `diff-snapshots.ts` does not exist (import/module error), not because of test syntax errors.

---

#### Task `tool-diff-snapshots-green`

**Title**: Implement `debug_diff_snapshots` tool to pass tests.

**Description**: Create `packages/server/src/tools/diff-snapshots.ts` per §3f. Requests two snapshots by sequence number from the adapter, computes a structural diff (added/removed/changed keys), returns the diff. Implement the diff algorithm in the tool handler itself (simple recursive object comparison — no external diff library). Respect `max_depth` and `max_changes` parameters to bound computation. Register with `title`, `annotations`, and `outputSchema`. Write the minimal code to make all tests pass, then refactor while keeping tests green.

**Depends on**: `tool-diff-snapshots-red`

**Produces**: `packages/server/src/tools/diff-snapshots.ts`

**Acceptance**: `bun run test tests/unit/tools/diff-snapshots.test.ts` — all tests pass. No previously passing tests broken.

---

### Phase 6 — MCP Resource Handlers

#### Task `resource-session`

**Title**: Implement `debug://session/current` resource.

**Description**: Create `packages/server/src/resources/session.ts` that registers a static MCP resource at `debug://session/current`. When read, it queries `ConnectionManager` for adapter info and returns session metadata. Returns error if not connected.

**Depends on**: `ws-connection-manager-green`, `types-errors-green`

**Produces**: `packages/server/src/resources/session.ts`

**Acceptance**: Lint passes. Types compile.

---

#### Task `resource-redux-state`

**Title**: Implement `debug://redux/state` resource.

**Description**: Create `packages/server/src/resources/redux-state.ts` that registers a static MCP resource at `debug://redux/state`. When read, requests the latest Redux state snapshot from the adapter and returns it as JSON text content. Applies `MAX_RESPONSE_CHARS` truncation.

**Depends on**: `ws-connection-manager-green`, `types-errors-green`

**Produces**: `packages/server/src/resources/redux-state.ts`

**Acceptance**: Lint passes. Types compile.

---

#### Task `resource-navigation-state`

**Title**: Implement `debug://navigation/state` resource.

**Description**: Create `packages/server/src/resources/navigation-state.ts` that registers a static MCP resource at `debug://navigation/state` for the latest navigation state.

**Depends on**: `ws-connection-manager-green`, `types-errors-green`

**Produces**: `packages/server/src/resources/navigation-state.ts`

**Acceptance**: Lint passes. Types compile.

---

### Phase 7 — Server Assembly and Entry Point

#### Task `server-assembly`

**Title**: Assemble MCP server with all tools and resources.

**Description**: Create `packages/server/src/server.ts` that exports a `createMcpServer(connectionManager, config)` function. It instantiates `McpServer` from `@modelcontextprotocol/sdk` using `server.registerTool()` (not deprecated `server.tool()`), registers all 6 tools (§3) with their Zod `inputSchema`, `outputSchema`, `title`, `description`, and `annotations`, and registers all 3 resources (§4). Returns the configured `McpServer` instance.

**Depends on**: All `tool-*-green` tasks, all `resource-*` tasks.

**Produces**: `packages/server/src/server.ts`

**Acceptance**: Lint passes. Types compile.

---

#### Task `entry-point`

**Title**: Implement main entry point.

**Description**: Update `packages/server/src/index.ts` to implement the full startup sequence (§9): load config (including non-loopback warning), create `ConnectionManager`, start WebSocket server (with security hardening), create MCP server, connect to `StdioServerTransport`, register shutdown handlers (`SIGINT`, `SIGTERM`). This is the runnable entry point.

**Depends on**: `server-assembly`, `ws-server`, `types-config-green`, `util-logger`

**Produces**: `packages/server/src/index.ts` (updated)

**Acceptance**: `bun run src/index.ts` starts the server, logs startup info to stderr, WebSocket server is listening.

---

### Phase 8 — Integration Tests

#### Task `integration-ws-connection`

**Title**: Write WebSocket connection integration tests.

**Description**: Create `packages/server/tests/integration/ws-connection.test.ts`. Start the real WebSocket server, connect the mock adapter, verify handshake is validated, verify disconnect is handled, verify that a second connection replaces the first (old connection's in-flight requests rejected), verify Host/Origin header validation rejects disallowed values.

**Depends on**: `entry-point`, `test-mock-adapter`

**Produces**: `packages/server/tests/integration/ws-connection.test.ts`

**Acceptance**: `bun run test tests/integration/ws-connection.test.ts` — all tests pass.

---

#### Task `integration-tool-roundtrip`

**Title**: Write MCP tool roundtrip integration tests.

**Description**: Create `packages/server/tests/integration/tool-roundtrip.test.ts`. Start the full server (WebSocket + MCP), connect mock adapter, invoke each MCP tool via the MCP SDK client, verify the round-trip: tool call → WebSocket request → mock adapter response → MCP result. Test at least: `debug_health_check` (connected), `debug_get_snapshot` (with mock Redux state), `debug_query_events` (with mock events), and a disconnected-adapter error case.

**Depends on**: `entry-point`, `test-mock-adapter`, `test-fixtures`

**Produces**: `packages/server/tests/integration/tool-roundtrip.test.ts`

**Acceptance**: `bun run test tests/integration/tool-roundtrip.test.ts` — all tests pass.

---

#### Task `integration-resource-roundtrip`

**Title**: Write MCP resource roundtrip integration tests.

**Description**: Create `packages/server/tests/integration/resource-roundtrip.test.ts`. Similar to tool roundtrip but for resources. Connect mock adapter, read each resource URI via MCP client, verify content matches mock adapter data.

**Depends on**: `entry-point`, `test-mock-adapter`, `test-fixtures`

**Produces**: `packages/server/tests/integration/resource-roundtrip.test.ts`

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

**Task `transport-http`**: Add Streamable HTTP as an alternative MCP transport. Configurable via env var (e.g., `MCP_TRANSPORT=http`). Uses `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk/server/streamableHttp.js` on port `3100`. The WebSocket server remains unchanged.

**Task `transport-http-tests`**: Integration tests for HTTP transport.

---

## 12) Task Dependency Graph

```text
scaffold-init
├── scaffold-vitest ─────────────────────────────────────────────────────┐
├── scaffold-src-dirs                                                    │
│   ├── types-config-red ←── scaffold-vitest                             │
│   │   └── types-config-green                                           │
│   │       ├── util-logger                                              │
│   │       └── ws-server ←─────────────────────────────────────────────┐│
│   ├── types-errors-red ←── scaffold-vitest                            ││
│   │   └── types-errors-green                                          ││
│   ├── types-debug-event                                               ││
│   │   ├── types-wire-protocol                                         ││
│   │   │   ├── ws-connection-manager-red ←── scaffold-vitest,          ││
│   │   │   │                                  types-config-green,      ││
│   │   │   │                                  util-logger              ││
│   │   │   │   └── ws-connection-manager-green ────────────────────────┘│
│   │   │   └── test-mock-adapter                                        │
│   │   └── test-fixtures                                                │
│   └── util-json-path-red ←── scaffold-vitest                           │
│       └── util-json-path-green                                         │
│                                                                        │
│  Tool Red/Green pairs (each -red depends on scaffold-vitest +          │
│  relevant -green dependencies; each -green depends on its -red):       │
│   ├── tool-health-check-red → tool-health-check-green                  │
│   ├── tool-list-streams-red → tool-list-streams-green                  │
│   ├── tool-get-snapshot-red → tool-get-snapshot-green                   │
│   ├── tool-query-events-red → tool-query-events-green                  │
│   ├── tool-get-state-path-red → tool-get-state-path-green              │
│   └── tool-diff-snapshots-red → tool-diff-snapshots-green              │
│                                                                        │
│  Resources (depend on ws-connection-manager-green, types-errors-green): │
│   ├── resource-session                                                 │
│   ├── resource-redux-state                                             │
│   └── resource-navigation-state                                        │
│                                                                        │
│  Assembly (after all tool-*-green + resources):                        │
├── server-assembly → entry-point                                        │
│                                                                        │
│  Integration (after entry-point + test helpers):                       │
├── integration-ws-connection                                            │
├── integration-tool-roundtrip                                           │
└── integration-resource-roundtrip                                       │
│                                                                        │
│  Polish (after entry-point):                                           │
├── readme                                                               │
└── package-bin                                                          │
```

---

## 13) References

- **Parent spec**: [Debug Data Adapter and MCP Server Specification](./Debug%20Data%20Adapter%20and%20MCP%20Server%20Specification.md)
- **MCP TypeScript SDK**: https://github.com/modelcontextprotocol/typescript-sdk (`@modelcontextprotocol/sdk` ^1.26.0)
- **MCP Architecture Concepts**: https://modelcontextprotocol.io/docs/concepts/architecture
- **Prior art (closest)**: https://github.com/fysnerd/expo-devtools-mcp
- **ws library**: https://github.com/websockets/ws
