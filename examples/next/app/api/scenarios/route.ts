// Control plane for the planted-bug scenarios (the "apply the fix" lever).
//
//   GET  /api/scenarios            -> current buggy/fixed state of each scenario
//   POST /api/scenarios            -> flip one: { "scenario": "checkout", "fixed": true }
//
// This is demo harness, not part of the NextDog quick-start — it exists so the
// debug-loop walkthrough (and the automated e2e test) can reproduce a before/after
// deterministically without editing files mid-recording. The full loop this drives
// is proven end-to-end in packages/mcp/src/__tests__/e2e-debug-loop.test.ts.
import {
  isValidScenario,
  type ScenarioId,
  scenarioStates,
  setFixed,
} from '../../../lib/planted-bugs';

export function GET(): Response {
  return Response.json({ scenarios: scenarioStates() });
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    scenario?: unknown;
    fixed?: unknown;
  };

  const scenario = typeof body.scenario === 'string' ? body.scenario : '';
  if (!isValidScenario(scenario)) {
    console.warn(`[scenarios] rejected toggle — unknown scenario "${scenario}"`);
    return Response.json(
      { error: `unknown scenario "${scenario}"`, valid: scenarioStates().map((s) => s.scenario) },
      { status: 400 },
    );
  }

  const fixed = body.fixed === true;
  setFixed(scenario as ScenarioId, fixed);
  console.log(`[scenarios] ${scenario} is now ${fixed ? 'FIXED' : 'BUGGY'}`);
  return Response.json({ scenarios: scenarioStates() });
}
