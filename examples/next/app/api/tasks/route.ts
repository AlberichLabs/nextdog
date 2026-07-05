import { createTask, listTasks } from '../../../lib/tasks';

// GET /api/tasks — list tasks. A calm, normal request for the top of the demo.
export function GET(): Response {
  const tasks = listTasks();
  console.log(`[tasks] listing ${tasks.length} tasks`);
  return Response.json({ tasks });
}

// POST /api/tasks — create a task from a JSON body.
// This is the "money frame": NextDog captures the request body AND the response
// body and shows them side-by-side in the request detail pane.
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as { title?: unknown };
  const title = typeof body.title === 'string' ? body.title.trim() : '';

  if (!title) {
    console.warn('[tasks] rejected create — missing "title"');
    return Response.json({ error: 'title is required' }, { status: 400 });
  }

  const task = createTask(title);
  console.log(`[tasks] created task #${task.id}: ${task.title}`);
  return Response.json({ task }, { status: 201 });
}
