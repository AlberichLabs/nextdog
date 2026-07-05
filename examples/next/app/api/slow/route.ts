// GET /api/slow — an artificially slow route (~1.5s).
// It shows up as a long bar in the spans list and the trace waterfall, so the
// demo has an obvious "where did the time go?" request.
const DELAY_MS = 1500;

export async function GET(): Promise<Response> {
  console.log(`[slow] sleeping ${DELAY_MS}ms...`);
  await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  console.warn(`[slow] responded after ${DELAY_MS}ms`);
  return Response.json({ sleptMs: DELAY_MS });
}
