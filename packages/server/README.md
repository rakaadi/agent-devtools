# @agent-devtools/server

MCP server that exposes React Native app debug data to AI agents. It accepts WebSocket connections from in-app debug adapters, routes tool and resource requests to them, and communicates with MCP clients (Copilot CLI, Claude Code, Cursor) over stdio.

## Architecture

```
┌─────────────┐  stdio   ┌─────────────────┐  WebSocket  ┌────────────────┐
│  MCP Client │ ←──────→ │  MCP Server     │ ←─────────→ │  Debug Adapter │
│  (AI Agent) │          │  (this package) │             │  (in-app)      │
└─────────────┘          └─────────────────┘             └────────────────┘
```

The server holds no persistent state. All runtime data — Redux state, navigation state, MMKV storage — lives in the connected adapter's ring buffers. The server forwards requests and returns responses.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) >= 1.3.5
- An Expo/React Native app with [`@agent-devtools/adapter`](../adapter) installed

### Install

```bash
bun add @agent-devtools/server
```

### Run

```bash
# Direct
bun run packages/server/src/index.ts

# Via package script
bun run --filter @agent-devtools/server start

# Or with npx (after build)
npx agent-devtools-server
```

## Configuration

All settings are read from environment variables at startup. Defaults work for local development.

| Variable | Type | Default | Description |
|---|---|---|---|
| `WS_HOST` | string | `127.0.0.1` | WebSocket bind address. Non-loopback values trigger a security warning. |
| `WS_PORT` | number | `19850` | WebSocket port (1–65535). |
| `REQUEST_TIMEOUT_MS` | number | `5000` | Timeout for adapter requests in milliseconds (100–30000). |
| `MAX_PAYLOAD_SIZE` | number | `1048576` | Maximum WebSocket message size in bytes (1 KB–10 MB). |
| `MAX_RESPONSE_CHARS` | number | `50000` | Maximum response length in characters before truncation. |
| `LOG_LEVEL` | string | `info` | Log level: `debug`, `info`, `warn`, or `error`. |

## MCP Tools

All tools are read-only and idempotent. They query the connected adapter and return results.

| Tool | Description |
|---|---|
| `debug_health_check` | Check adapter connection status and server health. |
| `debug_list_streams` | List available debug streams and their event counts. |
| `debug_get_snapshot` | Retrieve the latest state snapshot for a stream. |
| `debug_query_events` | Query stream events with filtering, pagination, and time range. |
| `debug_get_state_path` | Resolve a dot-notation path from the latest snapshot. |
| `debug_diff_snapshots` | Compute structural differences between two stream snapshots. |

## MCP Resources

| Resource | URI | Description |
|---|---|---|
| Session | `debug://session/current` | Current debug session metadata. |
| Redux State | `debug://redux/state` | Latest Redux state tree. |
| Navigation State | `debug://navigation/state` | Current React Navigation state. |

## Public API

The package exports a single entry point:

```typescript
import { startServer } from '@agent-devtools/server'

await startServer()
```

`startServer` accepts an optional `Partial<StartupDeps>` object for dependency injection in tests (custom logger, config loader, etc.).

## Security

- Binds to `127.0.0.1` by default — not reachable from the network.
- Validates `Host` and `Origin` headers on WebSocket upgrade to prevent DNS rebinding.
- Logs a warning if `WS_HOST` is set to a non-loopback address.
- Designed for development use only.

## Development

```bash
# Run tests
bun run --filter @agent-devtools/server test

# Run tests in watch mode
bun run --filter @agent-devtools/server test:watch

# Run tests with coverage (80% threshold)
bun run --filter @agent-devtools/server test:coverage

# Type check
bun run --filter @agent-devtools/server build
```

## License

See the repository root for license information.
