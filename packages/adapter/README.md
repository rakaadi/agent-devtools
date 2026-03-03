# @agent-devtools/adapter

In-app, dev-only library that collects runtime state from a React Native app and transmits it to the [Agent DevTools MCP Server](../server) over WebSocket. It captures Redux actions, React Navigation state changes, and MMKV storage mutations, then makes them available to AI agents through the MCP protocol.

## Architecture

```
┌─────────────────────────────────────────────────┐
│  React Native App                               │
│                                                 │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐ │
│  │  Redux   │  │  Nav v7  │  │  MMKV         │ │
│  │  Store   │  │  Ref     │  │  Instances     │ │
│  └────┬─────┘  └────┬─────┘  └──────┬────────┘ │
│       │              │               │          │
│  ┌────▼──────────────▼───────────────▼────────┐ │
│  │            Debug Adapter                   │ │
│  │  collectors → ring buffer → WebSocket      │ │
│  └────────────────────┬───────────────────────┘ │
└───────────────────────┼─────────────────────────┘
                        │ ws://localhost:19850
                        ▼
                 ┌──────────────┐
                 │  MCP Server  │
                 └──────────────┘
```

## Getting Started

### Prerequisites

- React Native with Expo SDK
- [Bun](https://bun.sh) >= 1.3.5 (for development)

### Install

```bash
bun add @agent-devtools/adapter
```

React is an optional peer dependency, required only for the `useDebugAdapter` hook.

## Usage

### Imperative

```typescript
import { initDebugAdapter } from '@agent-devtools/adapter'

const adapter = initDebugAdapter({
  store,           // Redux store (optional)
  navigationRef,   // React Navigation container ref (optional)
  mmkvInstances,   // Record<string, MmkvInstance> (optional)
})

// Force a snapshot capture
adapter.captureSnapshot('redux')

// Clean up on shutdown
adapter.destroy()
```

### React Hook

```typescript
import { useDebugAdapter } from '@agent-devtools/adapter'

function App() {
  useDebugAdapter({ store, navigationRef })
  return <YourApp />
}
```

The hook calls `initDebugAdapter` on mount and `destroy` on unmount.

### Standalone Redux Middleware

If you need control over middleware ordering:

```typescript
import { createDebugMiddleware, initDebugAdapter } from '@agent-devtools/adapter'

const debugMiddleware = createDebugMiddleware()
const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefault) => getDefault().concat(debugMiddleware),
})

// initDebugAdapter detects the attached middleware and reuses it
initDebugAdapter({ store, navigationRef })
```

## API

### `initDebugAdapter(options): DebugAdapterHandle`

Creates collectors, connects to the MCP server, and begins streaming events. Returns a handle with:

- **`captureSnapshot(stream?)`** — force an event capture for the given stream (or all streams).
- **`destroy()`** — disconnect and clean up all subscriptions.
- **`isConnected()`** — returns `true` if the WebSocket connection is open.

Returns a no-op handle when `__DEV__` is `false`.

### `useDebugAdapter(options): void`

React hook wrapper around `initDebugAdapter`. Manages adapter lifecycle with `useEffect`.

No-op when `__DEV__` is `false`.

### `createDebugMiddleware(): DebugMiddleware`

Redux middleware factory. Returns a standard Redux middleware that captures dispatched actions. Marks the store with a symbol so `initDebugAdapter` can detect and reuse it.

No-op when `__DEV__` is `false`.

### Options

```typescript
interface InitDebugAdapterOptions {
  store?: ReduxStore
  navigationRef?: NavigationContainerRef
  mmkvInstances?: Record<string, MmkvInstance>
  config?: AdapterConfig
}

interface AdapterConfig {
  serverUrl?: string  // default: ws://localhost:19850
}
```

### Exported Types

`ActionLike`, `AdapterConfig`, `DebugAdapterHandle`, `InitDebugAdapterOptions`, `NavigationContainerRef`, `ReduxStore`

## Collectors

| Collector | Source | Captures |
|---|---|---|
| Redux | Store middleware | Dispatched actions and state snapshots |
| Navigation | `NavigationContainerRef` | Route changes and navigation state (React Navigation v7+) |
| MMKV | `MmkvInstance` listeners | Key-value store mutations (planned) |

Each collector writes events to a shared ring buffer. Errors within collectors are caught and logged — they never crash the host app.

## Design Constraints

- **Zero native dependencies.** Uses only React Native globals (`WebSocket`).
- **Tree-shakeable.** All exports compile to no-ops when `__DEV__` is `false`.
- **Non-invasive.** Subscribes to existing data sources; no monkey-patching.
- **New Architecture compatible.** Pure JS — works with Fabric and TurboModules.

## Development

```bash
# Run tests
bun run --filter @agent-devtools/adapter test

# Run tests in watch mode
bun run --filter @agent-devtools/adapter test:watch

# Run tests with coverage (80% threshold)
bun run --filter @agent-devtools/adapter test:coverage

# Type check
bun run --filter @agent-devtools/adapter build
```

## License

See the repository root for license information.
