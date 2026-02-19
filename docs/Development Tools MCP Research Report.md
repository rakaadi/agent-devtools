# Development Tools MCP Research Report

## Research question
Can `chrome-devtools-mcp` access data shown in Rozenite plugin panels (MMKV, Redux DevTools, React Navigation), or is it limited to standard Chrome DevTools surfaces?

## Short answer
`chrome-devtools-mcp` is scoped to standard Chrome DevTools/browser targets (automation, console, network, snapshot/screenshot, script evaluation, performance, emulation).  
It does **not** provide a documented API to directly read Rozenite custom plugin channels/panels (MMKV/Redux/React Navigation) as first-class MCP tools.

## Scope and method
- Documentation/protocol analysis only (no runtime experiment).
- Sources used:
  - Chrome DevTools MCP README + tool reference.
  - Rozenite official plugin docs (MMKV, Redux DevTools, React Navigation).
  - Rozenite package READMEs in this project (`node_modules/@rozenite/*`).
  - Current project integration files (`package.json`, `metro.config.cjs`, `src/App.tsx`, `src/navigator/AppNavigator.tsx`, `src/redux/store.ts`, `index.ts`).

## Findings

### 1) What Chrome DevTools MCP officially exposes
- The project describes itself as controlling and inspecting a **live Chrome browser**.
- Official tools are grouped into:
  - Input automation (`click`, `fill`, `press_key`, etc.)
  - Navigation automation (`new_page`, `navigate_page`, etc.)
  - Emulation (`emulate`, `resize_page`)
  - Performance (`performance_start_trace`, etc.)
  - Network (`list_network_requests`, `get_network_request`)
  - Debugging (`evaluate_script`, `list_console_messages`, `take_snapshot`, `take_screenshot`)
- There is no official tool category for custom React Native DevTools plugin panels or Rozenite plugin IPC.

### 2) How Rozenite plugins are surfaced
- Rozenite Metro and runtime docs state plugins are integrated into **React Native DevTools frontend** as plugin panels.
- Redux and React Navigation plugin docs explicitly say their panels appear in React Native DevTools sidebar.
- MMKV plugin docs describe storage inspection/editing through the MMKV panel in the same DevTools environment.

### 3) Project-specific state (this repo)
- Rozenite integrations are active:
  - Metro wrapping + Rozenite enhancers in `metro.config.cjs`.
  - Redux DevTools enhancer in `src/redux/store.ts`.
  - React Navigation hook in `src/navigator/AppNavigator.tsx`.
  - Network Activity hook in `src/App.tsx` and boot recording in `index.ts`.
- Installed Rozenite packages include Redux, React Navigation, Network Activity, Metro, Expo Atlas.
- `@rozenite/mmkv-plugin` is **not** currently installed in this project.

## Capability matrix

| Target data surface | Directly available in `chrome-devtools-mcp` | Indirectly possible | Conclusion |
|---|---|---|---|
| Rozenite MMKV panel data | No documented direct API | Only if data is separately exposed via page JS/console/network | Not first-class; Rozenite plugin remains required |
| Rozenite Redux DevTools panel data | No documented direct API | Possible only through custom exposure, not via plugin protocol | Not first-class; Rozenite plugin remains required |
| Rozenite React Navigation panel data | No documented direct API | Possible only through custom exposure, not via plugin protocol | Not first-class; Rozenite plugin remains required |

## Practical interpretation
- For your exact question: it is **not** “Chrome MCP can read all Rozenite plugin data by default.”  
- In practice, Chrome MCP is primarily the standard browser/DevTools layer (elements-like snapshots, console, network, performance, script eval, automation).
- Rozenite plugin data is a separate plugin integration surface in React Native DevTools. Keep Rozenite for MMKV/Redux/Navigation inspection workflows.

## Final recommendation
Use both tools for different jobs:
- `chrome-devtools-mcp`: browser-level automation/debug/perf/network/console tasks.
- Rozenite plugins: React Native-specific state/panel inspection (MMKV, Redux timeline/state, React Navigation timeline/state).

If you want MCP agents to consume MMKV/Redux/Navigation data directly, add an explicit bridge (for example, expose sanitized debug snapshots via app-level JS endpoint/log channel), instead of relying on implicit panel access.

## References
- Chrome DevTools MCP README: https://github.com/ChromeDevTools/chrome-devtools-mcp  
- Chrome DevTools MCP tool reference: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md  
- Rozenite plugin directory: https://rozenite.dev/plugin-directory  
- Rozenite MMKV plugin docs: https://www.rozenite.dev/docs/official-plugins/mmkv  
- Rozenite Redux DevTools docs: https://www.rozenite.dev/docs/official-plugins/redux-devtools  
- Rozenite React Navigation docs: https://www.rozenite.dev/docs/official-plugins/react-navigation  
- Local evidence:
  - `package.json` (Rozenite deps)
  - `metro.config.cjs`
  - `src/redux/store.ts`
  - `src/navigator/AppNavigator.tsx`
  - `src/App.tsx`
  - `index.ts`
  - `node_modules/@rozenite/{metro,runtime,redux-devtools-plugin,react-navigation-plugin}/README.md`
