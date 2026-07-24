// Planted-bug scenarios — a tiny, self-contained stage for demonstrating the
// NextDog MCP debug loop (drive -> observe -> assert RED -> fix -> assert GREEN).
//
// Each scenario route (app/api/scenarios/*) has a REAL bug and a REAL fix, both
// present in the source. A per-scenario flag chooses which code path runs, so a
// before/after can be reproduced deterministically — flip the flag via
// `POST /api/scenarios { scenario, fixed }` (what the automated e2e test and a
// scripted repro use) or just edit the buggy line and let Next hot-reload (what
// you would do fixing it for real). Nothing here persists; state is per server
// process and resets on restart.

export type ScenarioId = 'checkout' | 'report' | 'profile';

export const SCENARIO_IDS: readonly ScenarioId[] = ['checkout', 'report', 'profile'];

/** Human-readable description of each planted bug, surfaced by `GET /api/scenarios`. */
export const SCENARIO_INFO: Record<ScenarioId, { route: string; bug: string }> = {
  checkout: {
    route: 'GET /api/scenarios/checkout',
    bug: 'reads a field off an undefined object -> throws -> 500',
  },
  report: {
    route: 'GET /api/scenarios/report',
    bug: 'awaits N slow steps sequentially -> ~1.5s latency',
  },
  profile: {
    route: 'GET /api/scenarios/profile',
    bug: 'omits the required "email" field -> 200 with a bad response shape',
  },
};

function isValidScenario(value: string): value is ScenarioId {
  return (SCENARIO_IDS as readonly string[]).includes(value);
}

/**
 * Whether each scenario currently runs its FIXED code path. Defaults to buggy
 * (`false`) so a fresh clone demonstrates the bugs out of the box. The initial
 * state can be overridden at boot with `NEXTDOG_DEMO_FIXED` (a comma list of
 * scenario ids, or `all`) — handy for a "start green" recording.
 */
const fixedState: Record<ScenarioId, boolean> = { checkout: false, report: false, profile: false };

function applyEnvOverride(): void {
  const raw = process.env.NEXTDOG_DEMO_FIXED;
  if (!raw) return;
  const wanted = raw
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0);
  if (wanted.includes('all')) {
    for (const id of SCENARIO_IDS) fixedState[id] = true;
    return;
  }
  for (const token of wanted) {
    if (isValidScenario(token)) fixedState[token] = true;
  }
}

applyEnvOverride();

/** True when the given scenario should run its fixed (correct) code path. */
export function isFixed(id: ScenarioId): boolean {
  return fixedState[id];
}

/** Flip a scenario between its buggy and fixed code paths. Returns the new value. */
export function setFixed(id: ScenarioId, fixed: boolean): boolean {
  fixedState[id] = fixed;
  return fixedState[id];
}

/** Snapshot of every scenario's current buggy/fixed state, for the control route. */
export function scenarioStates(): Array<{
  scenario: ScenarioId;
  route: string;
  bug: string;
  fixed: boolean;
}> {
  return SCENARIO_IDS.map((scenario) => ({
    scenario,
    route: SCENARIO_INFO[scenario].route,
    bug: SCENARIO_INFO[scenario].bug,
    fixed: fixedState[scenario],
  }));
}

export { isValidScenario };
