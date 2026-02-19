# Debug Data Adapter and MCP Server Specification

> **Version:** 1.1 (Refined)
> **Status:** Draft
> **Last Updated:** 2025-08-14

---

## 1) Context

Ecalyptus is a React Native healthcare mobile app (Expo SDK ~54, RTK Query, React Navigation v7, React Native Paper). It uses [Rozenite](https://github.com/callstackincubator/rozenite) as its primary human-facing DevTools, with plugins for Redux DevTools, React Navigation, and Network Activity.

**Goal:** Expose development-time app state and events (Redux store, navigation state, MMKV storage) to AI agents via the [Model Context Protocol (MCP)](https://modelcontextprotocol.io), enabling automated verification loops — without modifying Rozenite or its plugins.

**Key constraint:** Rozenite and all its existing plugins remain completely untouched. No changes to `@rozenite/metro`, `@rozenite/redux-devtools-plugin`, `@rozenite/react-navigation-plugin`, `@rozenite/network-activity-plugin`, or `@rozenite/plugin-bridge`. They continue to serve as the primary human-facing debug UI.

---

## 2) Prior Art Analysis

Five existing projects were evaluated. None fully meets our requirements, but two provide strong architectural reference.

### 2a) V3RON/react-native-devtools-mcp

- **Repo:** https://github.com/V3RON/react-native-devtools-mcp
- **Status:** WIP / Experimental (v0.0.0)
- **Approach:** External process connects to Metro Inspector Proxy via CDP WebSocket. No app-side client required.
- **Capabilities:** React profiler (start/stop/data via `react-devtools-inline`), console log capture (CDP `Console.enable`), JS evaluation (`Runtime.evaluate`).
- **Transport:** Streamable HTTP MCP server (express, port 3000).
- **Architecture:** `MCP Server → Metro Inspector Proxy (CDP WebSocket) → App JS Runtime`
- **Relevance to us:**
  - Proves that Metro Inspector Proxy can be tapped for CDP-level data without app changes.
  - **Cannot** access Redux store state, navigation state, or MMKV — these are not exposed via CDP.
  - The JS evaluation tool (`Runtime.evaluate`) could theoretically query global state, but requires state to be exposed on `globalThis` — fragile and unstructured.
- **Key takeaway:** CDP-only approach is insufficient for structured Redux/Navigation/MMKV access.

### 2b) fysnerd/expo-devtools-mcp ⭐ (Closest Prior Art)

- **Repo:** https://github.com/fysnerd/expo-devtools-mcp
- **Status:** Published, functional monorepo (`packages/client` + `packages/mcp-server`).
- **Approach:** In-app `DevToolsProvider` wraps the app. MCP server runs locally with a WebSocket server. App connects TO the MCP server (reverse WebSocket pattern).
- **Capabilities:**
  - Screenshots (via `react-native-view-shot`)
  - Console log capture (monkey-patches `console.*`)
  - Navigation via Expo Router (`router.push`)
  - Element interaction (tap, fill, scroll) via registered elements
  - Accessibility tree snapshots (via `UIManager.measure`)
  - **Zustand store state inspection** via explicit `registerStore('name', getState)` pattern
- **Transport:** stdio MCP transport + WebSocket server (port 19876).
- **Architecture:** `MCP Client ← stdio → MCP Server ← WebSocket → App (DevToolsProvider)`
- **Relevance to us:**
  - **Proven pattern** for exposing app-internal state to an MCP server.
  - Uses explicit store registration — we need the same for RTK Query slices instead of Zustand.
  - Uses Expo Router — we use React Navigation v7 (different API).
  - No redaction layer, no healthcare data considerations, no MMKV support.
  - Wraps the entire app in a `ViewShot` component — we want minimal app invasion.
- **Key takeaway:** The reverse WebSocket + in-app collector pattern works. We adapt it for RTK Query and React Navigation v7.

### 2c) twodoorsdev/react-native-debugger-mcp

- **Repo:** https://github.com/twodoorsdev/react-native-debugger-mcp
- **Status:** Archived.
- **Capabilities:** Console log retrieval from Metro only.
- **Relevance:** Minimal. Proves basic Metro log access pattern but too limited for our needs.

### 2d) callstackincubator/cali (Same Org as Rozenite)

- **Repo:** https://github.com/callstackincubator/cali
- **Status:** Active, by Callstack (Rozenite maintainers).
- **Focus:** Build automation + device management (run/build apps, manage simulators, search libraries).
- **Relevance:** Complementary tool for build/device tasks, but does NOT inspect app runtime state. Notable because it's maintained by the same team as Rozenite — potential future integration opportunity.

### 2e) mobile-next/mobile-mcp

- **Repo:** https://github.com/mobile-next/mobile-mcp
- **Focus:** Device-level UI automation (tap, swipe, screenshot via ADB/Xcode tools).
- **Relevance:** Operates at the device layer, not app runtime. Not applicable for internal state inspection.

### Prior Art Comparison Matrix

| Capability | V3RON (CDP) | expo-devtools-mcp | Our Spec |
|---|---|---|---|
| Console logs | ✅ CDP | ✅ monkey-patch | ✅ collector |
| JS evaluation | ✅ CDP | ❌ | ✅ optional |
| React profiling | ✅ react-devtools-inline | ❌ | ❌ (Phase 2+) |
| Redux/RTK state | ❌ | ❌ (Zustand only) | ✅ **primary** |
| Navigation state | ❌ | ✅ (Expo Router) | ✅ (React Nav v7) |
| MMKV storage | ❌ | ❌ | ✅ (Phase 3) |
| Screenshots | ❌ | ✅ ViewShot | ❌ (out of scope) |
| Element interaction | ❌ | ✅ registered | ❌ (out of scope) |
| Redaction layer | ❌ | ❌ | ❌ (see Future Considerations) |
| No app changes needed | ✅ | ❌ (Provider wrap) | ❌ (minimal hooks) |
| Rozenite untouched | N/A | N/A | ✅ **hard constraint** |

---

## 3) Decision Summary

### Recommended approach
**Build an in-app debug data adapter + local MCP server, keeping Rozenite completely untouched as a parallel consumer.**

### Why the in-app adapter pattern (not CDP-only)
- CDP cannot access Redux store subscriptions, React Navigation state, or MMKV storage in a structured way.
- The V3RON project proves CDP limits: it only reaches React profiler, console, and JS eval.
- Structured state inspection requires app-side collectors that subscribe to the same data sources Rozenite does — but independently, at the source level.

### Why not modify Rozenite
- Rozenite plugin-bridge uses CDP abstraction with type-safe event maps designed for DevTools panels, not machine consumption.
- Plugin data flows through iframes in the DevTools frontend — not designed for external extraction.
- Coupling to plugin-bridge internals creates fragile dependencies on Rozenite release cycles.
- The Ecalyptus project needs Rozenite stable and unchanged for day-to-day human debugging.

---

## 4) Architecture

### Boundary Principle

Rozenite hooks and our debug adapter collectors both subscribe to the **same underlying data sources** (Redux store, navigation ref, MMKV instances) but operate as **independent, parallel consumers**. Neither reads from nor writes to the other.

```text
┌─────────────────────────────────────────────────────────┐
│              React Native App (DEV only)                │
│                                                         │
│  ┌─────────────────────┐  ┌──────────────────────────┐  │
│  │   Rozenite Plugins  │  │  Debug Data Adapter      │  │
│  │   (UNCHANGED)       │  │  (NEW, DEV-only)         │  │
│  │                     │  │                          │  │
│  │  • Redux DevTools   │  │  ┌────────────────────┐  │  │
│  │    Enhancer         │  │  │ Redux Collector    │  │  │
│  │  • React Nav Hook   │  │  │ (store.subscribe)  │  │  │
│  │  • Network Activity │  │  ├────────────────────┤  │  │
│  │  • (MMKV Plugin)    │  │  │ Navigation         │  │  │
│  │                     │  │  │ Collector           │  │  │
│  └─────────┬───────────┘  │  │ (onStateChange)    │  │  │
│            │              │  ├────────────────────┤  │  │
│    Rozenite DevTools      │  │ MMKV Collector     │  │  │
│    Frontend (human UI)    │  │ (Phase 3)          │  │  │
│                           │  └────────┬───────────┘  │  │
│  ┌────────────────┐       │           │              │  │
│  │  Redux Store   │◄──────┼───────────┘              │  │
│  │  Navigation    │       │  Normalize → Buffer      │  │
│  │  Ref           │       │  → Ring Buffer           │  │
│  │  MMKV          │       │           │              │  │
│  │  Instances     │       │  ┌────────▼───────────┐  │  │
│  └────────────────┘       │  │ WebSocket Server   │  │  │
│   (shared data sources)   │  │ (localhost only)   │  │  │
│                           │  └────────┬───────────┘  │  │
│                           └───────────┼──────────────┘  │
└───────────────────────────────────────┼─────────────────┘
                                        │ WS connection
                              ┌─────────▼─────────┐
                              │  MCP Debug Server  │
                              │  (local process)   │
                              │                    │
                              │  • tools/list      │
                              │  • tools/call      │
                              │  • resources/list  │
                              │  • resources/read  │
                              └─────────┬──────────┘
                                        │ stdio or
                                        │ Streamable HTTP
                              ┌─────────▼─────────┐
                              │  MCP Client        │
                              │  (Copilot CLI,     │
                              │   Cursor, Claude)  │
                              └────────────────────┘
```

### Component Boundaries

**1. Collectors (in-app, DEV-only)**

Each collector subscribes to one data source and emits normalized events:

| Collector | Data Source | Subscription Method | Emitted Events |
|---|---|---|---|
| Redux | `store` from `src/redux/store.ts` | `store.subscribe()` + `store.getState()` | `action_dispatched`, `state_snapshot` |
| Navigation | `navigationRef` from `AppNavigator.tsx` | `navigationRef.addListener('state')` | `route_change`, `navigation_snapshot` |
| MMKV | MMKV instances (Phase 3) | Wrapper around `set`/`delete` calls | `key_set`, `key_delete`, `storage_snapshot` |

Collectors run alongside existing Rozenite hooks — both subscribe to the same refs/stores independently.

**2. Debug Data Adapter (in-app, DEV-only)**

Owns the canonical event schema. Responsibilities:
- Normalize collector output into envelope format.
- Maintain per-stream ring buffers (configurable size, default 200 events).
- Maintain latest snapshot per stream (replaced on each new snapshot).
- Gated by `__DEV__` AND an env flag (e.g., `ECALYPTUS_DEBUG_ADAPTER=true`).

**3. Debug Transport (in-app, DEV-only)**

Lightweight WebSocket server running inside the app process:
- Binds to `127.0.0.1` only (localhost).
- Default port: `19850` (avoids collision with Rozenite and Metro ports).
- Protocol: JSON messages over WebSocket.
- Supports two message types:
  - **Request/Response**: MCP server sends a query, app responds with data.
  - **Push Events**: App pushes new events to connected MCP server (optional, for real-time streaming).

**Design choice — reverse vs. forward WebSocket:**
The `expo-devtools-mcp` project uses reverse WebSocket (MCP server listens, app connects). We use the same pattern because:
- App doesn't need to expose a server port externally.
- Handles reconnection gracefully (app retries on disconnect).
- Works across simulator, emulator, and physical device on same network.

**4. MCP Debug Server (local process)**

Standalone Node.js/Bun process:
- Runs a WebSocket server that the app connects to.
- Exposes MCP tools/resources via stdio transport (for Copilot CLI, Claude Code) or Streamable HTTP (for web-based MCP clients).
- Translates MCP tool calls into WebSocket requests to the app.
- Stateless: no persistent storage. All state lives in the app's ring buffers.

---

## 5) Data Contract

### Envelope Schema

All events emitted by collectors use one canonical envelope:

```typescript
interface DebugEvent {
  /** Which data stream this event belongs to */
  stream: 'redux' | 'navigation' | 'mmkv'

  /** Event type within the stream */
  event: string // stream-specific, see below

  /** ISO 8601 timestamp */
  timestamp: string

  /** Monotonic sequence number per stream (for ordering) */
  seq: number

  /** Stable session ID (reset on app restart) */
  sessionId: string

  /** Event payload (stream-specific shape) */
  payload: Record<string, unknown>

  /** Metadata */
  meta: {
    source: 'ecalyptus-mobile'
    adapterVersion: string
    truncated: boolean
    originalSize?: number // included when truncated
  }
}
```

### Stream-Specific Events

**Redux stream:**
| Event | Payload |
|---|---|
| `action_dispatched` | `{ type: string, meta?: object }` (action type + RTK Query metadata, no full payload by default) |
| `state_snapshot` | `{ state: object, stateSize: number }` (full or scoped state tree, size-capped) |
| `state_diff` | `{ path: string, prev: unknown, next: unknown }` (targeted diff for specific slice changes) |

**Navigation stream:**
| Event | Payload |
|---|---|
| `route_change` | `{ routeName: string, params: object, type: 'push' \| 'pop' \| 'replace' \| 'reset', stackDepth: number }` |
| `navigation_snapshot` | `{ routes: Array<{ name: string, params: object }>, index: number, stale: boolean }` |

**MMKV stream (Phase 3):**
| Event | Payload |
|---|---|
| `key_set` | `{ instance: string, key: string, valueType: string, valueSize: number }` |
| `key_delete` | `{ instance: string, key: string }` |
| `storage_snapshot` | `{ instance: string, keys: string[], totalSize: number }` |

### Size Limits

| Limit | Default | Configurable |
|---|---|---|
| Max event payload size | 50 KB | Yes |
| Max state snapshot size | 200 KB | Yes |
| Ring buffer per stream | 200 events | Yes |
| Max WebSocket message | 500 KB | Yes |

Payloads exceeding limits are truncated with `meta.truncated: true` and `meta.originalSize` set.

---

## 6) MCP Server Surface (v1)

### Tools

| Tool | Parameters | Returns |
|---|---|---|
| `debug_health_check` | none | Connection status, active streams, app session info |
| `debug_list_streams` | none | Available streams and their current event counts |
| `debug_get_snapshot` | `stream: string`, `scope?: string` (JSON path for partial) | Latest snapshot for the specified stream |
| `debug_query_events` | `stream: string`, `limit?: number`, `since_seq?: number`, `event_type?: string` | Paginated list of events from the ring buffer |
| `debug_get_state_path` | `path: string` (dot-notation, e.g. `"auth.user.role"`) | Value at the specified path in the Redux state tree |
| `debug_diff_snapshots` | `stream: string`, `base_seq: number`, `target_seq: number` | Structural diff between two snapshots |

### Resources

| URI | Description |
|---|---|
| `debug://session/current` | Current debug session metadata (sessionId, uptime, device info) |
| `debug://redux/state` | Latest Redux state snapshot |
| `debug://navigation/state` | Latest navigation state snapshot |
| `debug://mmkv/{instance}` | Latest MMKV snapshot for a named instance (Phase 3) |

### Error Contract

All tool errors return structured JSON:

```json
{
  "error": true,
  "code": "NOT_CONNECTED | STREAM_UNAVAILABLE | TIMEOUT | PAYLOAD_TOO_LARGE",
  "message": "Human-readable description",
  "details": {}
}
```

No hidden fallback values. No partial data without explicit `truncated` flag.

---

## 7) Collector Implementation Details

### Redux Collector

Subscribes to the existing Redux store exported from `src/redux/store.ts`:

```typescript
// Pseudocode — actual implementation will follow project conventions
import { store } from '@redux/store'

// Subscribe to dispatched actions via middleware
const debugMiddleware: Middleware = (storeApi) => (next) => (action) => {
  const result = next(action)
  if (__DEV__ && adapterEnabled) {
    emit({
      stream: 'redux',
      event: 'action_dispatched',
      payload: { type: action.type, meta: action.meta },
    })
  }
  return result
}

// Periodic or on-demand state snapshots
const captureSnapshot = () => {
  const state = store.getState()
  emit({
    stream: 'redux',
    event: 'state_snapshot',
    payload: { state: store.getState(), stateSize: sizeof(state) },
  })
}
```

**Integration point:** The middleware is added to the store configuration in `src/redux/store.ts` alongside the existing `queryErrorLogger` and `mutationDetailMiddleware` — guarded by `__DEV__`.

**Note:** This is independent of `rozeniteDevToolsEnhancer`. Both consume the same store but through separate mechanisms (middleware vs. enhancer).

### Navigation Collector

Subscribes to the existing `navigationRef` from `src/navigator/AppNavigator.tsx`:

```typescript
// Pseudocode
import { navigationRef } from '@navigator/AppNavigator'

navigationRef.addListener('state', (event) => {
  if (__DEV__ && adapterEnabled) {
    const state = navigationRef.getRootState()
    emit({
      stream: 'navigation',
      event: 'route_change',
      payload: {
        routeName: navigationRef.getCurrentRoute()?.name,
        params: navigationRef.getCurrentRoute()?.params,
        stackDepth: state.routes.length,
      },
    })
  }
})
```

**Integration point:** Listener added in `AppNavigator.tsx` or `App.tsx` alongside the existing `useReactNavigationDevTools({ ref: navigationRef })` call — both independently listen to the same ref.

### MMKV Collector (Phase 3)

Deferred until the project adopts `react-native-mmkv`. The collector will wrap MMKV instances with a proxy that emits events on `set`/`delete` operations.

---

## 8) Tech Stack

### App-side (React Native / Expo)

| Dependency | Purpose | Status |
|---|---|---|
| TypeScript | Language | Existing |
| Redux Toolkit ^2.11 | Store subscription | Existing |
| React Navigation v7 | Navigation ref listener | Existing |
| `react-native-mmkv` | MMKV wrapper (Phase 3) | Not yet installed |
| No new runtime dependencies | Adapter uses only built-in RN + existing deps | — |

The adapter adds no new npm dependencies to the app. It uses:
- `store.subscribe()` / middleware (Redux Toolkit, existing)
- `navigationRef.addListener()` (React Navigation, existing)
- Built-in `WebSocket` (React Native global)
- `JSON.stringify` for serialization

### MCP Server (local process, separate package)

| Dependency | Purpose | Version |
|---|---|---|
| `@modelcontextprotocol/sdk` | MCP protocol implementation | ^1.22.0 |
| `zod` | Schema validation | ^3.24 (or zod ^4.x for consistency with app) |
| `ws` | WebSocket server | ^8.18 |
| Node.js / Bun | Runtime | >=22 (matches project) |

### Transport

| Layer | Protocol | Port |
|---|---|---|
| App ↔ MCP Server | WebSocket (reverse: server listens, app connects) | 19850 |
| MCP Server ↔ AI Client | stdio (primary, for Copilot CLI / Claude Code) | N/A |
| MCP Server ↔ AI Client | Streamable HTTP (secondary, for web MCP clients) | 3100 |

---

## 9) Rozenite Non-Interference Guarantee

This section exists to make the boundary explicit and auditable.

### What stays unchanged
- `metro.config.cjs`: `withRozenite`, `withRozeniteExpoAtlasPlugin`, `withRozeniteReduxDevTools` — untouched.
- `src/redux/store.ts`: `rozeniteDevToolsEnhancer({ maxAge: 100 })` — untouched.
- `src/navigator/AppNavigator.tsx`: `useReactNavigationDevTools({ ref: navigationRef })` — untouched.
- `src/App.tsx`: `useNetworkActivityDevTools()` — untouched.
- `index.ts`: `withOnBootNetworkActivityRecording()` — untouched.
- All `@rozenite/*` packages in `devDependencies` — no version changes, no config changes.
- Rozenite env gate: `WITH_ROZENITE=true` in `metro.config.cjs` — untouched.

### What gets added (new, parallel)
- A Redux middleware in `src/redux/store.ts` (appended to middleware array, guarded by `__DEV__ && ECALYPTUS_DEBUG_ADAPTER`).
- A navigation state listener in `AppNavigator.tsx` or `App.tsx` (alongside existing Rozenite hook, guarded).
- Adapter module tree under `src/devtools/` (entirely new directory).
- MCP server package under `tools/mcp-debug-server/` (standalone, not part of the app bundle).

### Verification
A CI lint rule or startup assertion can verify that Rozenite-related imports and calls remain unmodified by diffing against a known baseline.

---

## 10) Security and Safety Model

### Hard Gates

| Gate | Mechanism |
|---|---|
| Build-time exclusion | `__DEV__` flag — adapter code tree-shaken in production |
| Runtime env flag | `ECALYPTUS_DEBUG_ADAPTER=true` required (default: off) |
| Localhost binding | WebSocket server binds to `127.0.0.1` only |

The adapter runs strictly on localhost in DEV builds. AI agents see exactly the same data a human developer sees in Rozenite — no redaction layer is applied. This keeps the implementation simple and ensures agents can fully verify their work against real app state.

### Audit Trail

Every MCP response includes:
- `meta.truncated`: whether payload was size-capped
- `meta.timestamp`: when the data was captured
- `meta.sessionId`: which debug session produced the data

---

## 11) Rollout Plan

### Phase 1 — Adapter Core + Redux Collector
- Define `DebugEvent` schema types and validation.
- Implement Redux middleware collector.
- Implement ring buffer with size limits.
- Unit test: envelope normalization, truncation.

### Phase 2 — Navigation Collector + Transport + MCP Server
- Implement navigation state listener collector.
- Implement in-app WebSocket client (connects to MCP server).
- Implement MCP debug server with tools/resources v1.
- Integration test: dispatch action → query via MCP tool → verify response.
- Validate with Copilot CLI / Claude Code.

### Phase 3 — MMKV Stream
- Add MMKV collector when `react-native-mmkv` is adopted.
- Emit MMKV events into same adapter contract.
- Add `debug://mmkv/{instance}` resource.

### Phase 4 — Polish and Hardening
- Add Streamable HTTP MCP transport option.
- Performance profiling of adapter overhead in dev builds.
- Add CI verification for Rozenite non-interference.
- Documentation: setup guide, AI verification recipes.

---

## 12) Testing and Verification Strategy

### Unit Tests (Adapter)
- Envelope normalization produces valid `DebugEvent` shape.
- Ring buffer evicts oldest events when full.
- Size-capped payloads include `truncated: true` and `originalSize`.

### Integration Tests (Transport + Server)
- App emits Redux action → MCP `debug_query_events` returns it.
- App navigation change → MCP `debug_get_snapshot` reflects new route.
- Malformed tool call → structured error response (not crash).
- Disconnected app → `debug_health_check` returns `NOT_CONNECTED`.

### Contract Tests
- `DebugEvent` schema validated with Zod at emission and reception.
- MCP tool response shapes validated against declared schemas.

### Manual Dev Validation
- Compare Rozenite Redux DevTools panel vs. `debug_get_snapshot(stream: 'redux')` for same action timeline.
- Verify that disabling the adapter (`ECALYPTUS_DEBUG_ADAPTER=false`) has zero impact on Rozenite functionality.

---

## 13) Risks and Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Adapter code leaks into production bundle | **High** | `__DEV__` gate + tree-shaking. CI check for adapter imports in prod build. |
| Adapter causes performance regression in dev | Medium | Ring buffers, payload caps, stream-level enable flags, sampling. Benchmark before/after. |
| Rozenite update breaks shared data source | Low | Collectors subscribe to Redux/Navigation/MMKV directly, not to Rozenite internals. Rozenite updates don't affect adapter. |
| MCP SDK breaking changes | Low | Pin `@modelcontextprotocol/sdk` to v1.x minor range. Deferred v2 migration. |

---

## 14) Proposed Repository Structure

```
src/devtools/                    # App-side adapter (DEV-only)
├── adapter/
│   ├── index.ts                 # Adapter initialization + enable gate
│   ├── schema.ts                # DebugEvent type + Zod validators
│   └── buffer.ts                # Ring buffer implementation
├── collectors/
│   ├── reduxCollector.ts        # Redux store middleware + snapshot
│   ├── navigationCollector.ts   # React Navigation state listener
│   └── mmkvCollector.ts         # MMKV wrapper (Phase 3)
└── transport/
    └── wsClient.ts              # WebSocket client (connects to MCP server)

tools/mcp-debug-server/          # Standalone MCP server package
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                 # Entry point (stdio transport)
│   ├── server.ts                # MCP server + tool/resource registration
│   ├── wsServer.ts              # WebSocket server (app connects here)
│   └── types.ts                 # Shared types with app adapter
└── README.md
```

---

## 15) Future Considerations

Items listed here are intentionally deferred from the initial implementation. They may become relevant as the project evolves or requirements change.

### 15a) Data Redaction Layer

**Context:** The adapter transmits app state (Redux, navigation, MMKV) over localhost to a local MCP server. Since both endpoints run on the developer's machine, the data never leaves the local network.

**Why deferred:** AI agents need to see exactly what a human developer sees in Rozenite to effectively verify their work. A redaction layer would hide data from agents that developers already have full access to, creating a capability gap without a real security benefit — the threat model for localhost-only DEV traffic does not warrant it.

**When to revisit:**
- If the debug transport is ever extended to work over a non-localhost network (e.g., remote debugging on physical devices via tunnel).
- If the adapter is used in a shared CI/staging environment where multiple users access the same debug stream.
- If compliance requirements explicitly mandate redaction even in local development tooling.

**Implementation path (if needed):** Add a `redaction.ts` module to `src/devtools/adapter/` that applies configurable field-pattern matching (e.g., `token`, `password`, `patient_*`) before the envelope is written to the ring buffer. Add a `meta.redacted: boolean` flag to the envelope schema.

---

## 16) References

### Project Documents
- [Development Tools MCP Research Report](./Development%20Tools%20MCP%20Research%20Report.md) — Establishes that chrome-devtools-mcp cannot access Rozenite plugin data.

### Prior Art (Evaluated)
- **V3RON/react-native-devtools-mcp**: https://github.com/V3RON/react-native-devtools-mcp — CDP-based RN DevTools MCP (WIP).
- **fysnerd/expo-devtools-mcp**: https://github.com/fysnerd/expo-devtools-mcp — In-app provider + MCP server for Expo (published).
- **twodoorsdev/react-native-debugger-mcp**: https://github.com/twodoorsdev/react-native-debugger-mcp — Metro log retrieval (archived).
- **callstackincubator/cali**: https://github.com/callstackincubator/cali — RN AI agent for build/device tasks (by Rozenite team).
- **mobile-next/mobile-mcp**: https://github.com/mobile-next/mobile-mcp — Device-level mobile automation MCP.

### Protocol and SDK
- MCP Architecture Concepts: https://modelcontextprotocol.io/docs/concepts/architecture
- MCP TypeScript SDK (v1.x): https://github.com/modelcontextprotocol/typescript-sdk
- Chrome DevTools MCP: https://github.com/anthropics/anthropic-quickstarts

### Rozenite
- Rozenite Plugin Development: https://www.rozenite.dev/docs/plugin-development/overview
- Rozenite Redux DevTools Plugin: https://www.rozenite.dev/docs/official-plugins/redux-devtools
- Rozenite React Navigation Plugin: https://www.rozenite.dev/docs/official-plugins/react-navigation
- Rozenite MMKV Plugin: https://www.rozenite.dev/docs/official-plugins/mmkv
