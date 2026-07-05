import { getTask } from '../../../../lib/tasks';

// GET /api/tasks/:id — fetch one task, or a real 404 for an unknown id.
// Demonstrates a 404 span with a response body in the dashboard.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const task = getTask(Number(id));

  if (!task) {
    console.warn(`[tasks] task #${id} not found`);
    return Response.json({ error: `task ${id} not found` }, { status: 404 });
  }

  console.log(`[tasks] fetched task #${task.id}`);
  return Response.json({ task });
}
