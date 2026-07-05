// GET /api/db — OPTIONAL SQL demo (opt-in, keeps the app zero-setup).
//
// NextDog auto-instruments the `pg` / `mysql2` drivers when they're present,
// emitting a child span with the SQL `db.statement` (bound param VALUES elided).
// A real span needs a real database, which can't be zero-setup — so this route
// is disabled by default and the rest of the app clones-and-runs with no DB.
//
// To see a genuine db.statement span:
//   1. cd examples/next && pnpm add pg
//   2. DATABASE_URL=postgres://user:pass@localhost:5432/db pnpm dev
//   3. hit /api/db
// Outbound `fetch` (see /api/outbound) already gives you child spans in the
// waterfall without any of this.

interface PgQueryResult {
  rows: Array<Record<string, unknown>>;
}
interface PgClient {
  connect(): Promise<void>;
  query(config: { text: string; values: unknown[] }): Promise<PgQueryResult>;
  end(): Promise<void>;
}
interface PgModule {
  Client: new (config: { connectionString: string }) => PgClient;
}

export async function GET(): Promise<Response> {
  const dsn = process.env.DATABASE_URL;
  if (!dsn) {
    console.info('[db] DATABASE_URL not set — SQL demo disabled (this route is opt-in)');
    return Response.json({
      enabled: false,
      note: 'Set DATABASE_URL and `pnpm add pg` in examples/next to emit a real db.statement span. The app is zero-setup by default.',
    });
  }

  // Variable specifier + ignore comments so the bundler never tries to resolve
  // `pg` at build time — it is an OPTIONAL, uninstalled-by-default driver.
  const driver = 'pg';
  const mod = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ driver).catch(
    () => null,
  )) as PgModule | null;
  if (!mod) {
    console.warn('[db] DATABASE_URL is set but the `pg` driver is not installed');
    return Response.json(
      { enabled: false, note: 'DATABASE_URL is set but `pg` is not installed. Run `pnpm add pg`.' },
      { status: 501 },
    );
  }

  const client = new mod.Client({ connectionString: dsn });
  await client.connect();
  try {
    console.log('[db] running demo query');
    const result = await client.query({
      text: 'SELECT $1::text AS service, NOW() AS queried_at',
      values: ['example-next'],
    });
    return Response.json({ enabled: true, row: result.rows[0] });
  } finally {
    await client.end();
  }
}
