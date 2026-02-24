import { DebugEventSchema, type DebugEvent } from '@agent-devtools/shared'

const META = {
  source: 'react-native-app',
  adapterVersion: '1.0.0',
  truncated: false,
} as const

const toDebugEvent = (event: DebugEvent): DebugEvent =>
  DebugEventSchema.parse(event)

export const REDUX_ACTION_DISPATCHED_EVENT = toDebugEvent({
  stream: 'redux',
  event: 'action_dispatched',
  timestamp: '2026-02-24T14:00:00.000Z',
  seq: 1,
  sessionId: 'session-fixture-1',
  payload: {
    type: 'auth/loginSuccess',
    meta: {
      requestId: 'req-login-1',
    },
  },
  meta: META,
})

export const REDUX_STATE_SNAPSHOT_EVENT = toDebugEvent({
  stream: 'redux',
  event: 'state_snapshot',
  timestamp: '2026-02-24T14:00:01.000Z',
  seq: 2,
  sessionId: 'session-fixture-1',
  payload: {
    state: {
      auth: {
        user: {
          id: 'u-1',
          role: 'admin',
          profile: {
            email: 'admin@example.com',
          },
        },
      },
      featureFlags: {
        betaTools: true,
      },
    },
    stateSize: 512,
  },
  meta: META,
})

export const NAVIGATION_ROUTE_CHANGE_EVENT = toDebugEvent({
  stream: 'navigation',
  event: 'route_change',
  timestamp: '2026-02-24T14:00:02.000Z',
  seq: 1,
  sessionId: 'session-fixture-1',
  payload: {
    routeName: 'Profile',
    params: {
      userId: 'u-1',
    },
    type: 'NAVIGATE',
    stackDepth: 2,
  },
  meta: META,
})

export const NAVIGATION_SNAPSHOT_EVENT = toDebugEvent({
  stream: 'navigation',
  event: 'navigation_snapshot',
  timestamp: '2026-02-24T14:00:03.000Z',
  seq: 2,
  sessionId: 'session-fixture-1',
  payload: {
    routes: [
      { name: 'Home' },
      { name: 'Profile', params: { userId: 'u-1' } },
    ],
    index: 1,
    stale: false,
  },
  meta: META,
})

export const DEBUG_EVENT_FIXTURES = [
  REDUX_ACTION_DISPATCHED_EVENT,
  REDUX_STATE_SNAPSHOT_EVENT,
  NAVIGATION_ROUTE_CHANGE_EVENT,
  NAVIGATION_SNAPSHOT_EVENT,
] as const

export const JSON_PATH_STATE_TREE = {
  auth: {
    user: {
      id: 'u-1',
      role: 'admin',
      profile: {
        email: 'admin@example.com',
      },
    },
  },
  routes: [
    { name: 'Home' },
    { name: 'Profile', params: { userId: 'u-1' } },
  ],
}

export const DIFF_BASE_STATE_TREE = {
  counter: 1,
  profile: {
    name: 'Ada',
    role: 'editor',
  },
  flags: {
    beta: false,
  },
}

export const DIFF_TARGET_STATE_TREE = {
  counter: 2,
  profile: {
    name: 'Ada Lovelace',
    role: 'admin',
  },
  flags: {
    beta: true,
  },
  notices: ['welcome'],
}
