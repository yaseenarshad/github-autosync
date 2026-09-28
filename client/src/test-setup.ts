// React 18+ refuses `act()` unless the environment opts in; every component suite needs it.
;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
