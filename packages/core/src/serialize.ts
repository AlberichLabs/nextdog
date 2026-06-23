/**
 * Shared JSON serialization for NextDog events.
 *
 * Spans carry nanosecond timestamps as `bigint`, which `JSON.stringify` cannot
 * represent natively (it throws on a bigint). Every place that serializes an
 * event — the HTTP API (`server.ts`), the SSE stream (`sse-stream.ts`), and the
 * on-disk NDJSON store (`file-store.ts`) — must encode bigints the same way so
 * the reader (`file-store.ts`'s `parseLine`) can round-trip them. This was three
 * byte-identical inline closures; it now lives here once so producer and reader
 * can never drift.
 *
 * Encoding: a bigint becomes the string `"<digits>n"` (e.g. `123n`). The reader
 * detects the trailing `n` and reconstructs the `BigInt`.
 */

/**
 * JSON.stringify replacer that encodes `bigint` values as `"<digits>n"` strings.
 * Pass directly as the second argument to `JSON.stringify`.
 */
export function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? `${value.toString()}n` : value;
}

/** `JSON.stringify(value)` with bigints encoded via {@link bigintReplacer}. */
export function serializeWithBigInt(value: unknown): string {
  return JSON.stringify(value, bigintReplacer);
}
