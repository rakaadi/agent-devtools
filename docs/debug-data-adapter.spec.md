# Debug Data Adapter — Technical Specification

> **Version:** 1.1
> **Status:** Draft
> **Last Updated:** 2026-02-19
> **Parent Spec:** [Debug Data Adapter and MCP Server Specification](./Debug%20Data%20Adapter%20and%20MCP%20Server%20Specification.md)
> **Sibling Spec:** [Agent DevTools MCP Server](./agent-devtools-mcp.spec.md)
> **Monorepo package:** `packages/adapter` (`@agent-devtools/adapter`)
> **Shared types package:** `packages/shared` (`@agent-devtools/shared`)

---

## 1) Scope

This document specifies the **Debug Data Adapter** — an in-app, DEV-only library that collects runtime state from a React Native app and transmits it to the Agent DevTools MCP Server over WebSocket. It is published as a standalone npm package consumed by any React Native app.

### What this spec covers

- Adapter core: initialization, enable gating, session management.
- Collectors: Redux, Navigation (v7+), MMKV (deferred).
- Ring buffer: per-stream event storage with size limits.
- Event normalization: the `DebugEvent` envelope schema.
- WebSocket transport client: reverse connection to MCP server.
- Public API: imperative `initDebugAdapter()` + React hook `useDebugAdapter()`.
- Integration guide: how a consumer app wires the adapter.
- Shared types package: wire protocol types shared with the MCP server.

### What this spec does NOT cover

- MCP server — see [agent-devtools-mcp.spec.md](./agent-devtools-mcp.spec.md).
- Rozenite plugins — untouched, per the parent spec's non-interference guarantee.
- MCP protocol details — the adapter has no knowledge of MCP.

### Design principles

1. **App-agnostic.** The adapter does not import from any specific app. Consumer apps pass their data sources (store, navigation ref) via the public API.
2. **Zero native dependencies.** Uses only React Native globals (`WebSocket`) and React (for the hook API). No additional RN packages to link.
3. **DEV-only, defense-in-depth.** All code paths are gated by `__DEV__`. The adapter is a no-op in production — the entire module tree should be tree-shaken out. Despite DEV-only scope, the adapter validates data source inputs at init, sanitizes log output (no raw state dumping to console), and validates all incoming WebSocket messages against the wire protocol schema.
4. **Non-invasive.** Subscribes to the same data sources the app already uses. Does not monkey-patch, wrap providers, or modify component trees beyond what the consumer explicitly opts into.
5. **Redux-agnostic.** Works with any Redux-compatible store (plain Redux, RTK, RTK Query). RTK-specific metadata (e.g., `action.meta`) is captured when present, not required.
6. **Fail-safe collectors.** Collector errors (e.g., `getState()` throws, `navigationRef.getCurrentRoute()` returns undefined) are caught and logged — they never crash the consumer app or propagate uncaught exceptions. A failed collector emits no event for that cycle; subsequent cycles proceed normally.
7. **New Architecture compatible.** The adapter's API surface is pure JavaScript (Redux middleware, React Navigation listeners, WebSocket client). It uses no native modules, no bridge calls, and no UIManager interactions. This makes it compatible with both the classic architecture and React Native's New Architecture (Fabric renderer, TurboModules) without any conditional code paths.

---

## 2) Monorepo Context

This adapter lives in a monorepo alongside the MCP server and a shared types package:

```
devtools-mcp/                        # Repository root
├── packages/
│   ├── server/                      # MCP server (see agent-devtools-mcp.spec.md)
│   ├── adapter/                     # This package (debug data adapter)
│   └── shared/                      # Wire protocol types + DebugEvent schema
├── docs/
├── AGENTS.md
└── package.json                     # Workspace root
```

**Package names:**
- `@agent-devtools/adapter` — this package
- `@agent-devtools/server` — MCP server
- `@agent-devtools/shared` — shared types

The `shared` package is the single source of truth for wire protocol message types, `StreamName` / event type unions, and the `DebugEvent` envelope schema. Both `adapter` and `server` import from it.

---

## 3) Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│  Consumer React Native App (DEV only)                       │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  @agent-devtools/adapter                            │    │
│  │                                                     │    │
│  │  ┌─────────────────┐  ┌─────────────────────────┐   │    │
│  │  │  Adapter Core   │  │  Collectors              │   │    │
│  │  │                 │  │                          │   │    │
│  │  │  • Session mgmt │  │  ┌────────────────────┐  │   │    │
│  │  │  • Enable gate  │  │  │ Redux Collector    │  │   │    │
│  │  │  • Event        │  │  │ (middleware)        │  │   │    │
│  │  │    normalization │  │  ├────────────────────┤  │   │    │
│  │  │                 │  │  │ Navigation         │  │   │    │
│  │  └────────┬────────┘  │  │ Collector (v7+)    │  │   │    │
│  │           │           │  ├────────────────────┤  │   │    │
│  │           │           │  │ MMKV Collector     │  │   │    │
│  │           ▼           │  │ (Phase D1)         │  │   │    │
│  │  ┌─────────────────┐  │  └────────┬───────────┘  │   │    │
│  │  │  Ring Buffers   │  │           │              │   │    │
│  │  │  (per-stream)   │◄─┼───────────┘              │   │    │
│  │  └────────┬────────┘  └──────────────────────────┘   │    │
│  │           │                                          │    │
│  │  ┌────────▼────────┐                                 │    │
│  │  │  WS Transport   │                                 │    │
│  │  │  Client          │                                │    │
│  │  │  (connects TO    │                                │    │
│  │  │   MCP server)    │                                │    │
│  │  └────────┬─────────┘                                │    │
│  └───────────┼──────────────────────────────────────────┘    │
│              │                                               │
│  ┌───────────┴──────────┐     ┌──────────────────────┐       │
│  │  Redux Store         │     │  Navigation Ref      │       │
│  │  (app-owned)         │     │  (app-owned)         │       │
│  └──────────────────────┘     └──────────────────────┘       │
└──────────────────┬───────────────────────────────────────────┘
                   │ WS (connects to localhost:19850)
                   │ Wire Protocol (@agent-devtools/shared)
┌──────────────────▼──────────────────┐
│  Agent DevTools MCP Server          │
│  (@agent-devtools/server)           │
└─────────────────────────────────────┘
```

### Data flow

1. **Collector** subscribes to a data source (store, nav ref) and emits raw events.
2. **Adapter core** normalizes the raw event into a `DebugEvent` envelope (adds timestamp, seq, sessionId, meta).
3. **Ring buffer** stores the envelope. If the buffer is full, the oldest event is evicted.
4. **WS transport client** is notified of new events and can push them to the MCP server (if connected).
5. When the MCP server sends a **request** (e.g., "get latest Redux snapshot"), the transport client routes it to the adapter core, which reads from the ring buffer and responds.

---

## 4) Public API

The adapter exposes two integration patterns: imperative (for non-React contexts or early initialization) and hook-based (for React component trees).

### 4a) Imperative API

```typescript
import { initDebugAdapter } from '@agent-devtools/adapter'

const adapter = initDebugAdapter({
  // Required: at least one data source
  store?: ReduxStore           // Any Redux-compatible store (getState, subscribe, dispatch)
  navigationRef?: NavigationContainerRef  // React Navigation v7+ ref

  // Optional: MMKV instances (Phase D1)
  mmkvInstances?: Record<string, MMKVInstance>

  // Optional: configuration overrides
  config?: Partial<AdapterConfig>
})

// Returned handle
interface DebugAdapterHandle {
  /** Gracefully disconnect and clean up all subscriptions */
  destroy(): void

  /** Check if the adapter is connected to the MCP server */
  isConnected(): boolean

  /** Manually trigger a state snapshot for a stream */
  captureSnapshot(stream: StreamName): void

  /** Add a data source after initialization */
  attachStore(store: ReduxStore): void
  attachNavigationRef(ref: NavigationContainerRef): void
  attachMmkvInstance(name: string, instance: MMKVInstance): void
}
```

**Behavior:**
- If `__DEV__` is `false`, `initDebugAdapter()` returns a **no-op handle** — all methods are no-ops, no subscriptions are created, no WebSocket connection is attempted.
- If `__DEV__` is `true`, the adapter starts immediately: creates collectors for each provided data source, starts the ring buffers, and initiates WebSocket connection to the MCP server.
- Calling `initDebugAdapter()` multiple times is an error (logs a warning and returns the existing handle).
- **Data source validation:** At init, the adapter performs runtime duck-type checks on provided data sources:
  - `store` must have `getState` (function), `subscribe` (function), and `dispatch` (function). If any are missing, the Redux collector is skipped and a warning is logged.
  - `navigationRef` must have `addListener` (function), `getCurrentRoute` (function), and `getRootState` (function). If any are missing, the Navigation collector is skipped and a warning is logged.
  - Invalid or missing data sources do not prevent the adapter from starting — other collectors and the WebSocket transport still initialize.

### 4b) React Hook API

```typescript
import { useDebugAdapter } from '@agent-devtools/adapter'

function App() {
  const store = useAppStore()
  const navigationRef = useNavigationContainerRef()

  useDebugAdapter({
    store,
    navigationRef,
  })

  return <NavigationContainer ref={navigationRef}>...</NavigationContainer>
}
```

**Behavior:**
- Internally calls `initDebugAdapter()` on mount and `destroy()` on unmount.
- Handles ref readiness: waits for `navigationRef.isReady()` before attaching the navigation collector.
- Safe to call in production — the hook is a no-op when `__DEV__` is `false`.
- If the store or navigationRef changes (unlikely in practice), the hook tears down the old collector and creates a new one.

### 4c) Redux middleware export

For apps that prefer explicit middleware composition:

```typescript
import { createDebugMiddleware } from '@agent-devtools/adapter'

const debugMiddleware = createDebugMiddleware()

const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefault) =>
    getDefault().concat(debugMiddleware),
})

// Then pass the store to initDebugAdapter or useDebugAdapter
```

This is an **alternative** to passing `store` to `initDebugAdapter()`. When the middleware is used, the adapter detects it and skips creating its own internal middleware. This gives the consumer full control over middleware ordering.

---

## 5) Configuration

All configuration has sensible defaults. The consumer can override via the `config` option in `initDebugAdapter()`.

```typescript
interface AdapterConfig {
  /** MCP server WebSocket URL to connect to. Must be ws:// or wss://. */
  serverUrl: string                // default: 'ws://127.0.0.1:19850'

  /** Per-stream ring buffer capacity (number of events, 10–10_000) */
  bufferSize: number               // default: 200

  /** Max event payload size in bytes before truncation (1024–524_288) */
  maxPayloadSize: number           // default: 51_200 (50 KB)

  /** Max state snapshot size in bytes before truncation (1024–1_048_576) */
  maxSnapshotSize: number          // default: 204_800 (200 KB)

  /** Max WebSocket message size in bytes (1024–1_048_576). Must not exceed server's MAX_PAYLOAD_SIZE. */
  maxMessageSize: number           // default: 524_288 (512 KB)

  /** Reconnection delay in ms (exponential backoff base, 100–10_000) */
  reconnectBaseDelay: number       // default: 1000

  /** Max reconnection delay in ms (1000–60_000) */
  reconnectMaxDelay: number        // default: 30_000

  /** Streams to enable (allows disabling specific collectors) */
  enabledStreams: StreamName[]     // default: ['redux', 'navigation']

  /** Enable verbose logging to console (DEV only) */
  debug: boolean                   // default: false

  /** WebSocket connection timeout in ms (1000–30_000) */
  connectTimeout: number           // default: 5000
}
```

### Config validation

Configuration is validated with Zod at initialization. Invalid values throw immediately with a descriptive error — fail fast, no silent fallbacks. Specific validations:
- `serverUrl` must match `^wss?://` pattern.
- Numeric fields are validated with min/max ranges (shown in comments above).
- `enabledStreams` must contain at least one valid stream name.
- `maxMessageSize` must be ≤ the server's `MAX_PAYLOAD_SIZE` (defaults are compatible: adapter 512 KB < server 1 MB).

---

## 6) DebugEvent Envelope

All events emitted by collectors are normalized into a canonical envelope before being stored in the ring buffer. The envelope schema is defined in `@agent-devtools/shared` and imported by both the adapter and the MCP server.

```typescript
interface DebugEvent {
  /** Which data stream this event belongs to */
  stream: 'redux' | 'navigation' | 'mmkv'

  /** Event type within the stream */
  event: string

  /** ISO 8601 timestamp of when the event was captured */
  timestamp: string

  /** Monotonic sequence number per stream (for ordering and pagination) */
  seq: number

  /** Stable session ID (generated on adapter init, reset on app restart) */
  sessionId: string

  /** Event payload (shape depends on stream + event type) */
  payload: Record<string, unknown>

  /** Metadata about the event */
  meta: {
    /** Identifier of the source app (configurable, defaults to 'react-native-app') */
    source: string
    /** Adapter package version */
    adapterVersion: string
    /** Whether the payload was truncated due to size limits */
    truncated: boolean
    /** Original payload size in bytes (present only when truncated) */
    originalSize?: number
  }
}
```

### Stream-specific event types

**Redux stream:**

| Event | Payload shape | Description |
|---|---|---|
| `action_dispatched` | `{ type: string, meta?: object }` | Action type + optional metadata (e.g., RTK Query `meta`). Full action payload excluded by default. |
| `state_snapshot` | `{ state: object, stateSize: number }` | Full or scoped Redux state tree. Size-capped per `maxSnapshotSize`. |
| `state_diff` | `{ path: string, prev: unknown, next: unknown }` | Targeted diff for slice-level changes. Emitted by the collector when it detects a change. |

**Navigation stream:**

| Event | Payload shape | Description |
|---|---|---|
| `route_change` | `{ routeName: string, params?: object, type: string, stackDepth: number }` | Emitted on every navigation state change. `type` is the navigation action type. |
| `navigation_snapshot` | `{ routes: Array<{ name: string, params?: object }>, index: number, stale: boolean }` | Full navigation state tree from `getRootState()`. |

**MMKV stream (Phase D1):**

| Event | Payload shape | Description |
|---|---|---|
| `key_set` | `{ instance: string, key: string, valueType: string, valueSize: number }` | A key was written. Value not included (size only). |
| `key_delete` | `{ instance: string, key: string }` | A key was deleted. |
| `storage_snapshot` | `{ instance: string, keys: string[], totalSize: number }` | Full key list for an MMKV instance. |

### Size limits and truncation

| Limit | Default | Configurable via | Measures |
|---|---|---|---|
| Max event payload | 50 KB | `config.maxPayloadSize` | UTF-8 byte length |
| Max state snapshot | 200 KB | `config.maxSnapshotSize` | UTF-8 byte length |
| Ring buffer per stream | 200 events | `config.bufferSize` | Event count |
| Max WebSocket message | 512 KB | `config.maxMessageSize` | UTF-8 byte length |

> **Size measurement:** All byte-size limits measure the UTF-8 encoded length of the JSON-serialized value. The `sizeof` utility (§Phase 3) estimates this without full serialization for performance. Estimates target ±10% accuracy relative to `Buffer.byteLength(JSON.stringify(value), 'utf8')` (or the React Native equivalent using `TextEncoder`).

When a payload exceeds its size limit, the truncation algorithm:
1. Measures the serialized size of each top-level property in the payload.
2. Sorts properties by size, descending.
3. Removes the largest property and replaces it with `"[truncated]"`.
4. Re-measures. Repeats until the payload fits within the limit.
5. For array values that are too large: elements are removed from the end, and a `"[... N more items]"` sentinel is appended.
6. `meta.truncated` is set to `true`.
7. `meta.originalSize` is set to the pre-truncation byte size.

---

## 7) Collector Specifications

### 7a) Redux Collector

**Data source:** Any Redux-compatible store (must expose `getState()`, `subscribe()`, and accept middleware).

**Subscription method:** Redux middleware injected into the store's middleware chain.

**Emitted events:**

1. **`action_dispatched`** — emitted synchronously after each action is processed (after `next(action)`).
   - Captures `action.type` (always).
   - Captures `action.meta` if present (RTK Query metadata — not required).
   - Does NOT capture `action.payload` by default (size concern). The full payload is available on-demand via the snapshot.

2. **`state_snapshot`** — emitted on-demand when requested by the MCP server (via wire protocol), or periodically if configured. Not emitted on every action (performance).

3. **`state_diff`** — emitted when the collector detects that a top-level slice key has changed. Uses shallow equality comparison (`===`) on `getState()` top-level keys. Only the changed slice **key name** is recorded — the previous and new values for the changed slice are included, subject to `maxPayloadSize` truncation. If a single slice diff exceeds the payload limit, only the key name and a size indicator are emitted (no values).

**Performance note:** The shallow comparison runs after every dispatched action. This is O(k) where k is the number of top-level state keys — typically <50 and very fast. Deep comparison is intentionally avoided.

**Implementation approach:**

```typescript
// Pseudocode — the collector exports a middleware factory
export function createReduxCollector(emit: EmitFn): {
  middleware: Middleware
  captureSnapshot: () => void
  destroy: () => void
}
```

- The middleware is a standard Redux middleware. It calls `next(action)`, then emits `action_dispatched`.
- `captureSnapshot()` calls `store.getState()`, measures size, truncates if needed, emits `state_snapshot`.
- `state_diff` is computed by comparing the previous and current `getState()` result at the top-level keys after each action.
- `destroy()` is a no-op for middleware (Redux doesn't support middleware removal). The middleware internally checks an `enabled` flag and short-circuits when disabled.
- **Error handling:** If `getState()` throws during snapshot or diff, the error is caught and logged. No event is emitted for that cycle. The middleware continues processing subsequent actions normally.

**Middleware detection for `createDebugMiddleware()`:** When a consumer uses the explicit `createDebugMiddleware()` export (§4c), the middleware sets a flag on the store via a unique symbol property (`Symbol.for('agent-devtools:middleware-attached')`). When `initDebugAdapter()` receives a `store`, it checks for this symbol before creating its own middleware. If the symbol is present, the adapter reuses the existing middleware's emit channel instead of injecting a second middleware.

**Edge cases:**
- Store with no middleware support (rare): log a warning, skip Redux collection.
- Very large state trees: truncation kicks in per `maxSnapshotSize`.
- Rapid-fire actions: all are captured (ring buffer evicts oldest if full).

### 7b) Navigation Collector

**Data source:** React Navigation v7+ `NavigationContainerRef`.

**Subscription method:** `navigationRef.addListener('state', callback)` — the standard event API.

**Emitted events:**

1. **`route_change`** — emitted on every `state` event from the navigation ref.
   - `routeName`: from `getCurrentRoute()?.name`.
   - `params`: from `getCurrentRoute()?.params` (truncated if too large).
   - `type`: inferred from the navigation action that caused the change (push, pop, replace, reset, navigate). Falls back to `'unknown'` if not determinable.
   - `stackDepth`: `getRootState().routes.length`.

2. **`navigation_snapshot`** — emitted on-demand when requested by the MCP server. Calls `getRootState()` and returns the full navigation tree.

**Implementation approach:**

```typescript
export function createNavigationCollector(
  navigationRef: NavigationContainerRef,
  emit: EmitFn,
): {
  captureSnapshot: () => void
  destroy: () => void
}
```

- The collector calls `navigationRef.addListener('state', ...)` to subscribe.
- `destroy()` calls the unsubscribe function returned by `addListener`.
- The collector waits for `navigationRef.isReady()` before subscribing. If the ref is not ready at creation time, it defers subscription.

**Edge cases:**
- Navigation ref not ready at init: deferred subscription (poll or listen for `ready` event).
- Deeply nested navigators: `getRootState()` returns the full tree regardless of nesting.
- Params with sensitive data: no redaction (per parent spec decision). The adapter transmits what the app contains.
- **Error handling:** If `getCurrentRoute()` returns `undefined` (e.g., during navigator initialization), the `route_change` event is emitted with `routeName: 'unknown'` and `params: null`. If `getRootState()` throws, the snapshot request returns an `ADAPTER_ERROR` response via the wire protocol.

### 7c) MMKV Collector (Phase D1 — Deferred)

**Data source:** `react-native-mmkv` instances.

**Subscription method:** Proxy wrapper around MMKV `set`/`delete` methods. The consumer passes MMKV instances to the adapter, and the adapter wraps their mutating methods to emit events.

**Emitted events:** `key_set`, `key_delete`, `storage_snapshot` (see §6).

**Deferral reason:** The primary consumer app has not yet adopted `react-native-mmkv`. The adapter's MMKV support is designed but not implemented until the first consumer needs it.

---

## 8) Ring Buffer

Each enabled stream has its own ring buffer instance. The ring buffer is the adapter's primary data structure — all events flow through it, and the MCP server queries it.

### Interface

```typescript
interface RingBuffer<T> {
  /** Push an event into the buffer. Returns the assigned seq number. */
  push(event: T): number

  /** Get events with seq > sinceSeq, up to limit. */
  query(options: {
    sinceSeq?: number
    limit?: number
    filter?: (event: T) => boolean
  }): { events: T[]; hasMore: boolean }

  /** Get the latest event matching an optional filter. */
  latest(filter?: (event: T) => boolean): T | undefined

  /** Current buffer stats. */
  stats(): {
    count: number
    oldestSeq: number
    latestSeq: number
    capacity: number
  }

  /** Clear all events. */
  clear(): void
}
```

### Behavior

- Fixed capacity (default 200, configurable per `config.bufferSize`).
- Oldest events are evicted when capacity is reached (FIFO).
- Sequence numbers are monotonically increasing per stream and never reset within a session (even when events are evicted).
- Thread-safe is not a concern (JS is single-threaded), but the buffer must handle re-entrant calls (e.g., an action dispatch triggers another dispatch).
- The buffer stores `DebugEvent` envelopes — events are already normalized and size-capped before insertion.

### Snapshot slot

Each stream also maintains a **latest snapshot slot** — a single-item storage for the most recent snapshot event. This is separate from the ring buffer:
- The snapshot slot is overwritten (not appended) each time a new snapshot is captured.
- The MCP server's `debug_get_snapshot` tool reads from the snapshot slot, not the ring buffer.
- Snapshot events are also pushed into the ring buffer (for historical querying via `debug_query_events`).

---

## 9) WebSocket Transport Client

The adapter runs a WebSocket **client** that connects to the MCP server's WebSocket server (reverse connection pattern).

### Connection lifecycle

1. **Connect**: On adapter init, attempt to connect to `config.serverUrl` (default `ws://127.0.0.1:19850`). Connection attempt times out after `config.connectTimeout` (default 5000ms). If `config.serverUrl` does not match `^wss?://`, the connection is not attempted and a warning is logged.
2. **Handshake**: On open, send a `HandshakeMessage` (defined in `@agent-devtools/shared`) with: `sessionId`, `adapterVersion`, enabled streams, and device info.
3. **Ready**: On handshake acknowledgment, the transport is ready. Start accepting requests from the MCP server.
4. **Requests**: The MCP server sends request messages (e.g., "get latest Redux snapshot"). The transport client routes them to the adapter core, which reads from ring buffers and responds.
5. **Push events** (optional): When a new event is pushed into a ring buffer while a WebSocket connection is open, the transport can forward it to the MCP server for real-time awareness. This is optional and configurable.
6. **Disconnect**: On WebSocket close/error, enter reconnection loop.

### Keepalive

The transport sends a lightweight ping frame every 30 seconds when the connection is idle (no messages sent in the last 30 seconds). If no pong is received within 10 seconds, the connection is considered dead and the reconnection loop begins. This detects silent disconnects (e.g., MCP server process crash without clean close).

### Reconnection

- Exponential backoff: `min(reconnectBaseDelay * 2^attempt, reconnectMaxDelay)`.
- Reconnection is silent (no user-facing errors). The adapter continues collecting events locally regardless of connection state.
- On reconnect, the adapter sends a fresh handshake. The MCP server treats it as a new connection (the adapter's ring buffers still have historical data).

### Request routing

The transport client maintains a request ID → response callback map for pending requests. When a request comes in from the MCP server:

1. Parse the message using the wire protocol schema from `@agent-devtools/shared`.
2. If parsing fails (Zod validation error), log a warning with the error details and discard the message. Do not crash.
3. Route to the appropriate handler based on request type (e.g., `get_snapshot`, `query_events`).
4. The handler reads from ring buffers / snapshot slots and returns a response.
5. If the handler throws, catch the error and respond with an `ErrorMessage` (wire protocol) containing the error details. The MCP server maps this to `ADAPTER_ERROR`.
6. Serialize the response and send it back over WebSocket.

### Message size enforcement

Outgoing messages are checked against `config.maxMessageSize`. If a response would exceed the limit, it is truncated (remove payload data, set `meta.truncated: true`) and re-serialized.

---

## 10) Enable Gating

The adapter has a two-layer enable gate:

### Layer 1: `__DEV__` flag (build-time)

- All adapter code paths check `__DEV__` first.
- In production builds, `__DEV__` is `false`, and bundlers (Metro) tree-shake the entire adapter module tree.
- The public API (`initDebugAdapter`, `useDebugAdapter`) returns no-op stubs when `__DEV__` is `false`.

### Layer 2: Runtime flag (optional)

- The consumer app can optionally gate the adapter behind a runtime env variable (e.g., via `expo-constants` or a build-time env injection).
- This is NOT enforced by the adapter — it's the consumer's responsibility.
- Example: the consumer only calls `initDebugAdapter()` when a flag is set.

### Tree-shaking guarantee

The adapter's package entry point must be structured so that a production build that never calls `initDebugAdapter()` or `useDebugAdapter()` results in zero adapter code in the bundle. This means:
- No top-level side effects in the package entry point.
- All initialization is lazy (triggered by the consumer's explicit call).
- The `package.json` should include `"sideEffects": false`.

### WebSocket availability

The adapter uses React Native's built-in `WebSocket` global (W3C-compatible API available in both JSC and Hermes). The adapter does NOT use Node.js `ws` at runtime. If `WebSocket` is not available in the global scope (e.g., SSR environments, certain test runners), the transport client is disabled and a warning is logged. Collectors and ring buffers still function — events are stored locally but cannot be transmitted.

---

## 10a) Security Considerations

Although the adapter is DEV-only, it applies the following safeguards to align with the MCP server's defense-in-depth approach (see sibling spec §6):

1. **Server URL validation**: `config.serverUrl` is validated to match `^wss?://` at init. Arbitrary URLs (e.g., `http://`, `ftp://`) are rejected.

2. **Message validation**: All incoming WebSocket messages from the MCP server are validated against the wire protocol Zod schemas (imported from `@agent-devtools/shared`). Malformed messages are logged and discarded.

3. **No raw state in logs**: When `config.debug` is `true`, the adapter logs event metadata (stream, event type, seq, payload size) but never logs raw state payloads. This prevents accidental exposure of sensitive app state in console output.

4. **Payload size enforcement**: Outgoing messages are checked against `config.maxMessageSize` before sending. Oversized messages are truncated (not silently dropped) with `meta.truncated: true`.

5. **Connection scope**: The adapter only connects to a single configured server URL. It does not broadcast, discover, or accept incoming connections.

---

## 11) Session Management

- A `sessionId` is generated (UUIDv4 via `crypto.getRandomValues` — available in React Native's JSC and Hermes engines) when `initDebugAdapter()` is called. `Math.random` is NOT used as a fallback due to poor entropy.
- The `sessionId` is stable for the lifetime of the adapter (until `destroy()` is called or the app restarts).
- The `sessionId` is included in every `DebugEvent.sessionId` and in the WebSocket handshake.
- On hot reload (React Native Fast Refresh), the adapter is re-initialized with a new session ID. This is expected — the MCP server detects a new handshake and resets its adapter state.

### Hot reload cleanup

When Fast Refresh re-executes module code, the previous adapter instance may still hold open WebSocket connections and collector subscriptions. To prevent leaks:
- `initDebugAdapter()` checks for an existing global adapter instance (stored via a module-scoped variable). If found, it calls `destroy()` on the old instance before creating the new one.
- This ensures that at most one adapter instance exists at any time, even across hot reloads.

---

## 12) Project Structure

```
packages/adapter/
├── src/
│   ├── index.ts                    # Public API: initDebugAdapter, useDebugAdapter, createDebugMiddleware
│   ├── adapter.ts                  # Adapter core: init, session, enable gate, event normalization
│   ├── types.ts                    # Public types: AdapterConfig, DebugAdapterHandle, ReduxStore, etc.
│   ├── collectors/
│   │   ├── redux.ts                # Redux collector (middleware + snapshot)
│   │   ├── navigation.ts           # Navigation collector (v7+ listener)
│   │   └── mmkv.ts                 # MMKV collector (Phase D1, stub)
│   ├── buffer/
│   │   └── ring-buffer.ts          # Ring buffer implementation + snapshot slot
│   ├── transport/
│   │   └── ws-client.ts            # WebSocket client (reverse connection to MCP server)
│   └── utils/
│       ├── truncate.ts             # Payload size measurement and truncation
│       ├── sizeof.ts               # Fast JSON size estimation (without full serialization)
│       └── uuid.ts                 # Minimal UUIDv4 generator (no external dep)
├── tests/
│   ├── unit/
│   │   ├── adapter.test.ts
│   │   ├── ring-buffer.test.ts
│   │   ├── truncate.test.ts
│   │   ├── sizeof.test.ts
│   │   ├── collectors/
│   │   │   ├── redux.test.ts
│   │   │   └── navigation.test.ts
│   │   └── transport/
│   │       └── ws-client.test.ts
│   ├── integration/
│   │   └── adapter-to-server.test.ts  # Full round-trip with mock MCP server
│   └── helpers/
│       ├── mock-store.ts           # Minimal Redux-compatible store for testing
│       ├── mock-navigation-ref.ts  # Mock NavigationContainerRef
│       └── mock-ws-server.ts       # Mock WebSocket server (simulates MCP server)
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### Shared types package

```
packages/shared/
├── src/
│   ├── index.ts                    # Re-exports all shared types
│   ├── debug-event.ts              # DebugEvent interface + Zod schema
│   ├── wire-protocol.ts            # Wire protocol message types + Zod schemas
│   └── streams.ts                  # StreamName type, event type unions per stream
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## 13) Dependency Manifest

### `@agent-devtools/adapter`

**Runtime dependencies:**

| Package | Version | Purpose |
|---|---|---|
| `@agent-devtools/shared` | `workspace:*` | Wire protocol types, DebugEvent schema, StreamName |
| `zod` | `^3.24` | Config validation at init (§5) |

**Peer dependencies:**

| Package | Version | Purpose |
|---|---|---|
| `react` | `>=18` | For the `useDebugAdapter` hook |

**Dev dependencies:**

| Package | Version | Purpose |
|---|---|---|
| `typescript` | `^5.7` | Language |
| `vitest` | `^3.0` | Test framework |
| `ws` | `^8.18` | Mock WebSocket server for tests |
| `@types/ws` | `^8.18` | WebSocket type definitions for tests |

> **Why no `ws` runtime dep?** The adapter uses React Native's built-in `WebSocket` global at runtime. The `ws` package is only needed in tests to create a mock server in a Node.js environment.

### `@agent-devtools/shared`

**Runtime dependencies:**

| Package | Version | Purpose |
|---|---|---|
| `zod` | `^3.24` | Schema validation for wire protocol messages |

**Dev dependencies:**

| Package | Version | Purpose |
|---|---|---|
| `typescript` | `^5.7` | Language |
| `vitest` | `^3.0` | Test framework |

---

## 14) Testing Strategy

### Test framework

**vitest** — same as the MCP server package, consistent across the monorepo.

### Unit tests

| Module | Key assertions |
|---|---|
| `adapter.ts` | Init creates session, enable gate works, double-init warns (and destroys old instance), destroy cleans up, no-op in production, data source validation rejects invalid stores/refs |
| `ring-buffer.ts` | FIFO eviction, seq monotonicity, query with filters, snapshot slot overwrite, stats accuracy |
| `truncate.ts` | Payloads within limit pass through, oversized payloads truncated, `truncated` flag set, `originalSize` set, array truncation appends sentinel |
| `sizeof.ts` | Accurate size estimation for various payload shapes (within ±10% of `Buffer.byteLength(JSON.stringify(value), 'utf8')`) |
| `redux.ts` | Middleware emits `action_dispatched` with correct shape, `captureSnapshot` emits `state_snapshot`, `state_diff` detects slice changes, enabled flag respected, middleware detection via symbol, `getState()` error caught and logged |
| `navigation.ts` | Listener emits `route_change`, deferred subscription when ref not ready, `captureSnapshot` emits full tree, `destroy` unsubscribes, `getCurrentRoute()` returning undefined handled gracefully |
| `ws-client.ts` | Connects to server URL, sends handshake, routes incoming requests, reconnects on disconnect with exponential backoff, respects max message size, keepalive ping/pong, rejects invalid server URL, handles malformed incoming messages |

### Integration tests

| Test | Scenario |
|---|---|
| `adapter-to-server.test.ts` | Full round-trip: init adapter with mock store → adapter connects to mock WS server → dispatch Redux action → mock server receives push event → mock server sends snapshot request → adapter responds with state. Also: adapter responds with `ErrorMessage` when handler throws, adapter handles malformed server requests gracefully. |

### Test helpers

- **`mock-store.ts`**: Minimal Redux-compatible store with `getState()`, `subscribe()`, `dispatch()`, and middleware support. Configurable initial state.
- **`mock-navigation-ref.ts`**: Implements the subset of `NavigationContainerRef` the adapter uses: `addListener('state', ...)`, `getCurrentRoute()`, `getRootState()`, `isReady()`.
- **`mock-ws-server.ts`**: A `ws.WebSocketServer` that simulates the MCP server side: validates handshake, sends requests, receives responses.

---

## 15) Implementation Work Phases

Fine-grained, dependency-ordered tasks. Each task specifies files produced, dependencies, and acceptance criteria.

---

### Phase 1 — Monorepo and Shared Package Scaffolding

#### Task `monorepo-init`

**Title**: Convert repo to monorepo with bun workspaces.

**Description**: Update the root `package.json` to define `workspaces: ["packages/*"]`. Create `packages/` directory. Move existing MCP server source into `packages/server/` (if it exists) or create a placeholder. Create `packages/adapter/` and `packages/shared/` directories with their own `package.json` files. Each `package.json` should have correct `name`, `version`, `main`, `types`, `sideEffects`, and workspace dependencies. Set up a root `tsconfig.json` with project references and per-package `tsconfig.json` files that extend the root.

**Depends on**: Nothing.

**Produces**: Root `package.json` (updated), `packages/adapter/package.json`, `packages/shared/package.json`, `packages/server/package.json` (if not existing), root `tsconfig.json`, per-package `tsconfig.json`.

**Acceptance**: `bun install` at root succeeds. Workspace packages resolve each other.

---

#### Task `shared-scaffold`

**Title**: Scaffold the shared types package.

**Description**: Create `packages/shared/src/index.ts`, `packages/shared/src/debug-event.ts`, `packages/shared/src/wire-protocol.ts`, `packages/shared/src/streams.ts` as empty module files with placeholder exports. Add `vitest.config.ts`. Add `zod` as a runtime dependency.

**Depends on**: `monorepo-init`

**Produces**: `packages/shared/src/*`, `packages/shared/vitest.config.ts`

**Acceptance**: `bun run --filter @agent-devtools/shared build` (or tsc) compiles without errors.

---

#### Task `adapter-scaffold`

**Title**: Scaffold the adapter package.

**Description**: Create the directory tree from §12 with minimal placeholder files. Add `package.json` with `@agent-devtools/shared` as workspace dependency and `react` as peer dependency. Add `vitest.config.ts`. Create `src/index.ts` that exports no-op stubs for `initDebugAdapter`, `useDebugAdapter`, `createDebugMiddleware`.

**Depends on**: `monorepo-init`

**Produces**: `packages/adapter/src/*` (placeholders), `packages/adapter/package.json`, `packages/adapter/vitest.config.ts`

**Acceptance**: `bun install` succeeds. `packages/adapter/src/index.ts` compiles.

---

### Phase 2 — Shared Types

#### Task `shared-streams`

**Title**: Define stream name type and event type unions.

**Description**: Implement `packages/shared/src/streams.ts` with: `StreamName` type (`'redux' | 'navigation' | 'mmkv'`), per-stream event type unions (`ReduxEventType`, `NavigationEventType`, `MmkvEventType`), and a `StreamEventTypeMap` mapping each stream to its event types. Export all from `index.ts`.

**Depends on**: `shared-scaffold`

**Produces**: `packages/shared/src/streams.ts` (implemented)

**Acceptance**: Types compile. Lint passes.

---

#### Task `shared-debug-event`

**Title**: Implement DebugEvent envelope schema.

**Description**: Implement `packages/shared/src/debug-event.ts` with the `DebugEvent` TypeScript interface and a `DebugEventSchema` Zod object (per §6). The Zod schema should validate `stream`, `event`, `timestamp`, `seq`, `sessionId`, `payload`, and `meta` fields. Write unit tests in `packages/shared/tests/debug-event.test.ts` verifying valid events pass and invalid events are rejected.

**Depends on**: `shared-streams`

**Produces**: `packages/shared/src/debug-event.ts` (implemented), `packages/shared/tests/debug-event.test.ts`

**Acceptance**: `bun run test --filter @agent-devtools/shared` — tests pass.

---

#### Task `shared-wire-protocol`

**Title**: Define wire protocol message types.

**Description**: Implement `packages/shared/src/wire-protocol.ts` with TypeScript interfaces and Zod schemas for all wire protocol messages: `HandshakeMessage` (adapter → server), `HandshakeAckMessage` (server → adapter), `RequestMessage` (server → adapter), `ResponseMessage` (adapter → server), `PushEventMessage` (adapter → server), `ErrorMessage` (bidirectional). Each message has a `type` discriminator field. Include a `WireMessageSchema` discriminated union for parsing any incoming message. Write unit tests.

**Depends on**: `shared-debug-event`

**Produces**: `packages/shared/src/wire-protocol.ts` (implemented), `packages/shared/tests/wire-protocol.test.ts`

**Acceptance**: Tests pass. Both adapter and server can import these types.

---

### Phase 3 — Adapter Utilities

#### Task `util-sizeof`

**Title**: Implement fast JSON size estimation.

**Description**: Create `packages/adapter/src/utils/sizeof.ts` with a `sizeof(value)` function that estimates the UTF-8 byte length of a JSON-serialized value without performing full serialization. Uses a recursive traversal with early termination when a threshold is exceeded. In React Native, uses `TextEncoder` for accurate multi-byte character measurement on string leaves. Write unit tests in `packages/adapter/tests/unit/sizeof.test.ts`.

**Depends on**: `adapter-scaffold`

**Produces**: `packages/adapter/src/utils/sizeof.ts`, `packages/adapter/tests/unit/sizeof.test.ts`

**Acceptance**: Unit tests pass. Estimates are within ±10% of `Buffer.byteLength(JSON.stringify(value), 'utf8')` for test payloads.

---

#### Task `util-truncate`

**Title**: Implement payload truncation.

**Description**: Create `packages/adapter/src/utils/truncate.ts` with a `truncatePayload(payload, maxSize)` function that: measures the payload size (using `sizeof`), returns it unchanged if within limit, or progressively removes the largest top-level properties (replacing with `"[truncated]"`) and trims arrays from the end (appending `"[... N more items]"` sentinel) until the payload fits. Returns `{ payload, truncated: boolean, originalSize: number }`. Write unit tests covering objects, arrays, nested structures, and edge cases (single large string value).

**Depends on**: `util-sizeof`

**Produces**: `packages/adapter/src/utils/truncate.ts`, `packages/adapter/tests/unit/truncate.test.ts`

**Acceptance**: Unit tests pass. Truncated payloads are always within the size limit.

---

#### Task `util-uuid`

**Title**: Implement minimal UUIDv4 generator.

**Description**: Create `packages/adapter/src/utils/uuid.ts` with a `uuid()` function that generates a UUIDv4 string using `crypto.getRandomValues` (available in React Native's JSC and Hermes engines). Do NOT use `Math.random` — it lacks sufficient entropy for session identifiers. If `crypto.getRandomValues` is unavailable (should not happen in RN), throw an error at init rather than silently degrading. Write a basic unit test.

**Depends on**: `adapter-scaffold`

**Produces**: `packages/adapter/src/utils/uuid.ts`, `packages/adapter/tests/unit/uuid.test.ts`

**Acceptance**: Unit test passes. Generated strings match UUIDv4 format.

---

### Phase 4 — Ring Buffer

#### Task `ring-buffer`

**Title**: Implement the ring buffer with snapshot slot.

**Description**: Create `packages/adapter/src/buffer/ring-buffer.ts` implementing the `RingBuffer<T>` interface from §8. Backed by a fixed-size array with head/tail pointers. Include the snapshot slot (§8, "Snapshot slot") as a separate single-value store. Write comprehensive unit tests covering: push and eviction, seq monotonicity, query with `sinceSeq` / `limit` / `filter`, `latest()`, `stats()`, `clear()`, snapshot slot overwrite.

**Depends on**: `adapter-scaffold`

**Produces**: `packages/adapter/src/buffer/ring-buffer.ts`, `packages/adapter/tests/unit/ring-buffer.test.ts`

**Acceptance**: All unit tests pass. Ring buffer handles edge cases (empty buffer, full buffer, wrap-around).

---

### Phase 5 — Collectors

#### Task `collector-redux`

**Title**: Implement Redux collector.

**Description**: Create `packages/adapter/src/collectors/redux.ts` per §7a. Export `createReduxCollector(emit)` that returns `{ middleware, captureSnapshot, destroy }`. The middleware emits `action_dispatched` events. `captureSnapshot` emits `state_snapshot`. State diff detection compares top-level keys after each action and emits `state_diff` for changed slices. The `emit` callback receives raw event data; the adapter core normalizes it into a `DebugEvent` envelope. Write unit tests using `mock-store`.

**Depends on**: `ring-buffer`, `util-truncate`, `shared-debug-event`

**Produces**: `packages/adapter/src/collectors/redux.ts`, `packages/adapter/tests/unit/collectors/redux.test.ts`

**Acceptance**: Unit tests pass. Middleware correctly emits events for dispatched actions.

---

#### Task `collector-navigation`

**Title**: Implement Navigation collector.

**Description**: Create `packages/adapter/src/collectors/navigation.ts` per §7b. Export `createNavigationCollector(navigationRef, emit)` that returns `{ captureSnapshot, destroy }`. Subscribes via `addListener('state', ...)`. Handles deferred subscription when ref is not ready. Write unit tests using `mock-navigation-ref`.

**Depends on**: `ring-buffer`, `util-truncate`, `shared-debug-event`

**Produces**: `packages/adapter/src/collectors/navigation.ts`, `packages/adapter/tests/unit/collectors/navigation.test.ts`

**Acceptance**: Unit tests pass. Collector emits `route_change` on state changes.

---

#### Task `collector-mmkv-stub`

**Title**: Create MMKV collector stub.

**Description**: Create `packages/adapter/src/collectors/mmkv.ts` as a stub module that exports the same interface shape as other collectors but throws a descriptive "not yet implemented" error if called. This placeholder ensures the module structure is complete for Phase D1.

**Depends on**: `adapter-scaffold`

**Produces**: `packages/adapter/src/collectors/mmkv.ts`

**Acceptance**: Lint passes. Import compiles without errors.

---

### Phase 6 — Test Helpers

#### Task `test-mock-store`

**Title**: Create mock Redux store test helper.

**Description**: Create `packages/adapter/tests/helpers/mock-store.ts` — a minimal Redux-compatible store with configurable initial state, middleware support, `getState()`, `subscribe()`, `dispatch()`. Allows test code to dispatch actions and inspect emitted events.

**Depends on**: `adapter-scaffold`

**Produces**: `packages/adapter/tests/helpers/mock-store.ts`

**Acceptance**: Lint passes. Types compile.

---

#### Task `test-mock-navigation-ref`

**Title**: Create mock NavigationContainerRef test helper.

**Description**: Create `packages/adapter/tests/helpers/mock-navigation-ref.ts` — implements the subset of `NavigationContainerRef` used by the navigation collector: `addListener`, `getCurrentRoute`, `getRootState`, `isReady`. Allows test code to simulate navigation events.

**Depends on**: `adapter-scaffold`

**Produces**: `packages/adapter/tests/helpers/mock-navigation-ref.ts`

**Acceptance**: Lint passes. Types compile.

---

#### Task `test-mock-ws-server`

**Title**: Create mock WebSocket server test helper.

**Description**: Create `packages/adapter/tests/helpers/mock-ws-server.ts` — a `ws.WebSocketServer` that simulates the MCP server. Validates handshake, can send requests, captures push events, and provides assertion helpers.

**Depends on**: `shared-wire-protocol`

**Produces**: `packages/adapter/tests/helpers/mock-ws-server.ts`

**Acceptance**: Lint passes. Types compile.

---

### Phase 7 — WebSocket Transport Client

#### Task `transport-ws-client`

**Title**: Implement WebSocket transport client.

**Description**: Create `packages/adapter/src/transport/ws-client.ts` per §9. Export `createWsClient(config, handlers)` that returns `{ connect, disconnect, send, isConnected }`. Implements: server URL validation (`^wss?://`), connection to `config.serverUrl` with `config.connectTimeout`, handshake on open, reconnection with exponential backoff, request routing to handler callbacks, push event forwarding, message size enforcement, keepalive (ping every 30s, pong timeout 10s), incoming message validation against wire protocol Zod schemas. If `WebSocket` global is unavailable, logs a warning and returns a no-op client (all methods return immediately, `isConnected` always false). Write unit tests using `mock-ws-server`.

**Depends on**: `shared-wire-protocol`, `util-truncate`, `test-mock-ws-server`

**Produces**: `packages/adapter/src/transport/ws-client.ts`, `packages/adapter/tests/unit/transport/ws-client.test.ts`

**Acceptance**: Unit tests pass. Client connects, reconnects, routes requests, validates incoming messages, keepalive works.

---

### Phase 8 — Adapter Core and Public API

#### Task `adapter-core`

**Title**: Implement adapter core.

**Description**: Create `packages/adapter/src/adapter.ts` per §4a and §11. Implements: session ID generation, `__DEV__` gating, configuration validation (Zod), collector initialization for provided data sources, ring buffer creation per stream, event normalization (raw collector events → `DebugEvent` envelopes), WebSocket transport initialization, request handling (routes MCP server requests to ring buffer queries). Wire up the snapshot slot updates. Write unit tests for adapter lifecycle (init, destroy, double-init, no-op in production).

**Depends on**: `collector-redux`, `collector-navigation`, `collector-mmkv-stub`, `ring-buffer`, `transport-ws-client`, `util-uuid`, `shared-debug-event`

**Produces**: `packages/adapter/src/adapter.ts`, `packages/adapter/tests/unit/adapter.test.ts`

**Acceptance**: Unit tests pass. Adapter initializes with mock store, emits events, responds to requests.

---

#### Task `adapter-public-api`

**Title**: Implement public API exports.

**Description**: Update `packages/adapter/src/index.ts` to export the real implementations: `initDebugAdapter()` (wraps adapter core), `useDebugAdapter()` (React hook that calls init/destroy), `createDebugMiddleware()` (standalone middleware export). Implement `src/types.ts` with all public TypeScript types (`AdapterConfig`, `DebugAdapterHandle`, `ReduxStore`, `NavigationContainerRef` — as minimal interface types, not importing from `@react-navigation/*`). Ensure all exports are no-ops when `__DEV__` is `false`.

**Depends on**: `adapter-core`

**Produces**: `packages/adapter/src/index.ts` (updated), `packages/adapter/src/types.ts`

**Acceptance**: Lint passes. Types compile. Exports are correct.

---

### Phase 9 — Integration Tests

#### Task `integration-adapter-to-server`

**Title**: Write full round-trip integration test.

**Description**: Create `packages/adapter/tests/integration/adapter-to-server.test.ts`. Start a mock WebSocket server, initialize the adapter with a mock store, dispatch Redux actions, verify: adapter connects and sends handshake, push events arrive at mock server, mock server sends a snapshot request, adapter responds with current state.

**Depends on**: `adapter-public-api`, `test-mock-ws-server`, `test-mock-store`

**Produces**: `packages/adapter/tests/integration/adapter-to-server.test.ts`

**Acceptance**: `bun run test packages/adapter/tests/integration/` — all tests pass.

---

### Phase 10 — Documentation

#### Task `adapter-readme`

**Title**: Write adapter package README.

**Description**: Create `packages/adapter/README.md` with: package overview, installation (`bun add @agent-devtools/adapter`), quick start (imperative and hook API), configuration options table, supported data sources, how it works (high-level architecture), DEV-only guarantee.

**Depends on**: `adapter-public-api`

**Produces**: `packages/adapter/README.md`

**Acceptance**: README is accurate and matches the implemented API.

---

### Deferred Phases

#### Phase D1 — MMKV Collector

**Task `collector-mmkv`**: Implement the MMKV collector in `packages/adapter/src/collectors/mmkv.ts`. Wraps MMKV instances with a proxy for `set`/`delete` interception. Depends on a consumer app adopting `react-native-mmkv`.

---

## 16) Task Dependency Graph

```text
monorepo-init
├── shared-scaffold
│   └── shared-streams
│       └── shared-debug-event
│           └── shared-wire-protocol
│               ├── test-mock-ws-server
│               │   └── transport-ws-client
│               └── (used by adapter-core)
│
├── adapter-scaffold
│   ├── util-sizeof
│   │   └── util-truncate
│   │       ├── collector-redux
│   │       ├── collector-navigation
│   │       └── transport-ws-client
│   ├── util-uuid
│   │   └── adapter-core
│   ├── ring-buffer
│   │   ├── collector-redux
│   │   └── collector-navigation
│   ├── collector-mmkv-stub
│   │   └── adapter-core
│   ├── test-mock-store
│   │   └── integration-adapter-to-server
│   └── test-mock-navigation-ref
│       └── collector-navigation (tests)
│
│  Assembly (after collectors + transport):
├── adapter-core
│   └── adapter-public-api
│       ├── integration-adapter-to-server
│       └── adapter-readme
```

---

## 17) References

- **Parent spec**: [Debug Data Adapter and MCP Server Specification](./Debug%20Data%20Adapter%20and%20MCP%20Server%20Specification.md)
- **MCP server spec**: [agent-devtools-mcp.spec.md](./agent-devtools-mcp.spec.md)
- **React Navigation v7 ref API**: https://reactnavigation.org/docs/navigation-container/#ref
- **Redux Middleware API**: https://redux.js.org/api/applymiddleware
- **react-native-mmkv**: https://github.com/mrousavy/react-native-mmkv
