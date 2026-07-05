#!/usr/bin/env node
// Drives the example-next routes in a GIF-friendly order so a screen recording of
// the NextDog dashboard is clean and repeatable with one command.
//
// Usage:
//   pnpm demo-traffic                 # targets http://localhost:3000
//   BASE_URL=http://localhost:3001 pnpm demo-traffic
//
// The order tells a story: start calm → a normal write → an outbound call → the
// slow one → a 404 → a 500 → an unauthorized 401 → the authorized (replay-able)
// request → the optional SQL route.

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const AUTH_TOKEN = 'demo-secret-token';
const PAUSE_MS = 700;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function hit(label, path, init = {}) {
  const url = `${BASE_URL}${path}`;
  const method = init.method ?? 'GET';
  try {
    const response = await fetch(url, init);
    console.log(`  ${response.status}  ${method.padEnd(4)} ${path}  — ${label}`);
  } catch (error) {
    console.log(`  ERR  ${method.padEnd(4)} ${path}  — ${label} (${error.message})`);
    console.log(`\nIs the app running? Start it with: pnpm dev  (in examples/next)`);
    process.exit(1);
  }
  await sleep(PAUSE_MS);
}

async function main() {
  console.log(`\nDemo traffic → ${BASE_URL}\n`);

  await hit('calm: list tasks', '/api/tasks');

  await hit('normal write: request + response body capture', '/api/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Walk the dog at dawn' }),
  });

  await hit('outbound fetch → child span in the waterfall', '/api/outbound');

  await hit('the slow one (~1.5s)', '/api/slow');

  await hit('a 404', '/api/tasks/9999');

  await hit('a 500 (+ console.error with an Error)', '/api/boom');

  await hit('unauthorized: no token → 401', '/api/secure');

  await hit('authorized: Bearer token → 200 (replay this one)', '/api/secure', {
    headers: { authorization: `Bearer ${AUTH_TOKEN}` },
  });

  await hit('optional SQL route (opt-in; no-op unless DATABASE_URL + pg)', '/api/db');

  console.log('\nDone. Open the dashboard at http://localhost:6789\n');
}

main();
