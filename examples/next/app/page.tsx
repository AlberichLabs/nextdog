import { DemoButtons } from './demo-buttons';

interface RouteInfo {
  method: string;
  path: string;
  demos: string;
}

const ROUTES: RouteInfo[] = [
  { method: 'GET', path: '/api/tasks', demos: 'a calm, normal request' },
  { method: 'POST', path: '/api/tasks', demos: 'request + response BODY capture (the money frame)' },
  { method: 'GET', path: '/api/tasks/404', demos: 'a 404 with a response body' },
  { method: 'GET', path: '/api/secure', demos: 'Bearer auth → 401 without a token, Replay with it' },
  { method: 'GET', path: '/api/slow', demos: 'a ~1.5s request in the waterfall' },
  { method: 'GET', path: '/api/outbound', demos: 'an outbound fetch → auto-instrumented child span' },
  { method: 'GET', path: '/api/boom', demos: 'a 500 + a console.error with an Error object' },
  { method: 'GET', path: '/api/db', demos: 'optional SQL db.statement span (opt-in, see README)' },
];

export default function Home() {
  return (
    <main style={{ maxWidth: 820, margin: '0 auto', padding: '48px 24px' }}>
      <h1 style={{ fontSize: 32, marginBottom: 4 }}>NextDog · example-next</h1>
      <p style={{ color: '#94a3b8', marginTop: 0 }}>
        A tiny Next.js app wired to NextDog with the two-line quick-start. Open the dashboard at{' '}
        <a href="http://localhost:6789" style={{ color: '#2dd4bf' }}>
          localhost:6789
        </a>
        , then run <code style={codeStyle}>pnpm demo-traffic</code> (or click the buttons below) and
        watch the spans, bodies, and logs stream in.
      </p>

      <h2 style={{ fontSize: 20, marginTop: 32 }}>Routes</h2>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {ROUTES.map((route) => (
          <li key={`${route.method} ${route.path}`} style={{ marginBottom: 10 }}>
            <code style={codeStyle}>
              {route.method} {route.path}
            </code>{' '}
            <span style={{ color: '#94a3b8' }}>— {route.demos}</span>
          </li>
        ))}
      </ul>

      <h2 style={{ fontSize: 20, marginTop: 32 }}>Try it from the browser</h2>
      <DemoButtons />
    </main>
  );
}

const codeStyle = {
  background: '#1e293b',
  padding: '2px 6px',
  borderRadius: 4,
  fontSize: 13,
  fontFamily: 'ui-monospace, monospace',
};
