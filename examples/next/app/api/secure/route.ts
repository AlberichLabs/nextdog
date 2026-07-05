// GET /api/secure — a token-gated endpoint.
// Without a valid `Authorization: Bearer <token>` header it returns 401. Because
// NextDog stores credential headers locally, the 200 request can be re-issued
// straight from the dashboard with one-click Replay (auth token included) —
// that's the "Replay with the auth token" beat in the demo.
const DEMO_TOKEN = 'demo-secret-token';

export function GET(request: Request): Response {
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';

  if (token !== DEMO_TOKEN) {
    console.warn('[secure] denied — missing or invalid bearer token');
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  console.log('[secure] authorized request');
  return Response.json({ secret: 'the dog buried it under the porch' });
}
