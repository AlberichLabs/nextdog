// GET /api/boom — deliberately throws, producing a 500 span.
// It also logs an Error object via console.error so the Logs view shows a
// captured error (with its stack) correlated to this failing trace.
export function GET(): Response {
  const error = new Error('the dog ate the database');
  console.error('[boom] handler failed', error);
  throw error;
}
