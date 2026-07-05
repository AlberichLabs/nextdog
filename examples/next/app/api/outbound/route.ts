// GET /api/outbound — makes a server-side `fetch` to another local route.
// NextDog auto-instruments outbound fetch/http, so this call appears as a child
// span nested under this request in the waterfall (no external network needed —
// it calls this same app, which keeps the demo fully offline / zero-setup).
export async function GET(request: Request): Promise<Response> {
  const { origin } = new URL(request.url);
  console.log(`[outbound] fetching ${origin}/api/tasks`);

  const upstream = await fetch(`${origin}/api/tasks`);
  const data = (await upstream.json()) as { tasks: unknown[] };

  console.log(`[outbound] upstream returned ${data.tasks.length} tasks`);
  return Response.json({ fetchedFrom: `${origin}/api/tasks`, taskCount: data.tasks.length });
}
