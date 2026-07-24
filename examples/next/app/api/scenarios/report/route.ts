// Planted-bug scenario B — a slow endpoint.
//
// GET /api/scenarios/report assembles a report from several independent sections.
// The BUGGY path awaits each section sequentially, so the latencies add up to
// ~1.5s and the request shows a long bar in the trace waterfall. The FIXED path
// fetches the sections concurrently with Promise.all, collapsing the wall-clock
// time to that of the slowest single section (~0.3s). Flip between them with
// `POST /api/scenarios { "scenario": "report", "fixed": true }` or by editing the
// code below (Next hot-reloads).
import { isFixed } from '../../../../lib/planted-bugs';

const SECTIONS = ['revenue', 'signups', 'retention', 'errors', 'latency'] as const;
const SECTION_LATENCY_MS = 300;

async function loadSection(name: string): Promise<{ name: string; value: number }> {
  // Stand-in for a slow downstream call (a query, an upstream API, …).
  await new Promise((resolve) => setTimeout(resolve, SECTION_LATENCY_MS));
  return { name, value: Math.round(Math.random() * 1000) };
}

export async function GET(): Promise<Response> {
  const startedAt = Date.now();

  let sections: Array<{ name: string; value: number }>;
  if (isFixed('report')) {
    // FIX: the sections are independent, so load them concurrently.
    sections = await Promise.all(SECTIONS.map((name) => loadSection(name)));
  } else {
    // BUG: awaiting each section in turn serializes ~300ms x 5 = ~1.5s.
    sections = [];
    for (const name of SECTIONS) {
      sections.push(await loadSection(name));
    }
  }

  const tookMs = Date.now() - startedAt;
  console.log(`[report] assembled ${sections.length} sections in ${tookMs}ms`);
  return Response.json({ tookMs, sections });
}
