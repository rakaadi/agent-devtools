# Adapter Future Feature Additions Roadmap

This document captures feature additions intentionally deferred from the current adapter polishing/simplification phase, so they can be implemented in dedicated follow-up work.

## Scope of this roadmap

The current phase focuses on code simplification and small, test-backed spec/runtime alignment fixes.
The items below are larger behavior additions and architectural changes that require dedicated TDD cycles.

## Deferred feature additions

1. **WebSocket reconnection with exponential backoff**
   - Add reconnect loop with bounded backoff (`reconnectBaseDelay`, `reconnectMaxDelay`).
   - Spec reference: `docs/debug-data-adapter.spec.md` §9 (Reconnection).

2. **WebSocket keepalive (ping/pong)**
   - Add idle ping cadence and stale-connection detection/recovery.
   - Spec reference: `docs/debug-data-adapter.spec.md` §9 (Keepalive).

3. **Per-stream ring buffers**
   - Move from single-buffer-with-filter model to dedicated buffers per stream to avoid cross-stream eviction pressure.
   - Spec reference: `docs/debug-data-adapter.spec.md` §8.

4. **Middleware bridge wiring**
   - Fully wire `createDebugMiddleware()` symbol detection path so adapter reuses explicit middleware emit channel when present.
   - Spec reference: `docs/debug-data-adapter.spec.md` §4c and §7a.

5. **Data source duck-type validation hardening**
   - Explicit runtime validation and warning paths for invalid `store` / `navigationRef` shapes at init.
   - Spec reference: `docs/debug-data-adapter.spec.md` §4a.

6. **Collector snapshot/diff truncation coverage**
   - Ensure snapshot and diff payloads consistently enforce configured size limits and metadata reporting.
   - Spec reference: `docs/debug-data-adapter.spec.md` §6 and §7.

## Implementation guidance for future phases

- Apply strict TDD (`red -> green -> refactor`) per feature.
- Keep each feature isolated behind focused tests and small commits.
- Re-run adapter package tests and root tests for each feature batch.
