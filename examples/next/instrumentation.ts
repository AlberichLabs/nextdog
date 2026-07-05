// NextDog quick-start, step 2 of 2: register the instrumentation.
// Next.js calls register() once per server process. The import only runs on the
// Node.js runtime (not Edge), and @nextdog/next/register is itself a no-op unless
// NODE_ENV === 'development'.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('@nextdog/next/register');
  }
}
