/**
 * Defensive stack-trace parser (issue #89).
 *
 * `get_errors` captures the exception stack as a raw *string*; an agent then has
 * to eyeball it to find the offending `file:line`. This parses that string into
 * structured {@link StackFrame}s so the telemetry→code hop is machine-readable —
 * an ADDITIVE field alongside the existing `stack`, never a replacement.
 *
 * SOURCE MAPS — DEFERRED (rationale): the MCP server is a standalone stdio
 * process that talks to the sidecar over HTTP. It has no access to the user's
 * dev-build source maps (they live in the framework's build dir on the user's
 * machine) and no bundler/project-root context, and a source-map library would be
 * a new runtime dependency (CLAUDE.md: this ships inside users' dev servers —
 * weight matters). So we ship raw-stack frame parsing; remapping bundled positions
 * back to original sources is left as a follow-up.
 * TODO(#89): source-map remap once the sidecar can expose the build's source maps.
 *
 * Parsing is defensive by contract: it recognises the common V8 and
 * Firefox/Safari shapes, silently skips any line it can't read, and returns
 * `undefined` (never throws) when nothing is parseable so the caller simply omits
 * `frames`.
 */

export interface StackFrame {
  /** Function/method name, when the frame carries one. */
  function?: string;
  /** Source file path or URL as it appears in the stack (possibly bundled). */
  file: string;
  line: number;
  /** Column, when present (many stacks include line but not column). */
  column?: number;
}

// V8: `    at fn (file:line:col)` / `    at fn (file:line)`
const V8_WITH_FN = /^\s*at\s+(.+?)\s+\((.+?):(\d+)(?::(\d+))?\)\s*$/;
// V8 anonymous: `    at file:line:col` / `    at file:line`
const V8_NO_FN = /^\s*at\s+(.+?):(\d+)(?::(\d+))?\s*$/;
// Firefox/Safari: `fn@file:line:col` / `@file:line:col`
const SPIDERMONKEY = /^\s*(.*?)@(.+?):(\d+)(?::(\d+))?\s*$/;

function cleanFunction(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  // Drop a leading `async ` qualifier V8 prints for async frames.
  const fn = raw.replace(/^async\s+/, '').trim();
  return fn.length > 0 ? fn : undefined;
}

function frame(
  fn: string | undefined,
  file: string,
  line: string,
  col: string | undefined,
): StackFrame | null {
  const lineNo = Number(line);
  if (!file || !Number.isFinite(lineNo)) return null;
  const out: StackFrame = { file, line: lineNo };
  const cleaned = cleanFunction(fn);
  if (cleaned !== undefined) out.function = cleaned;
  if (col !== undefined) {
    const colNo = Number(col);
    if (Number.isFinite(colNo)) out.column = colNo;
  }
  return out;
}

function parseLine(line: string): StackFrame | null {
  let m = V8_WITH_FN.exec(line);
  if (m) return frame(m[1], m[2], m[3], m[4]);
  m = V8_NO_FN.exec(line);
  if (m) return frame(undefined, m[1], m[2], m[3]);
  m = SPIDERMONKEY.exec(line);
  if (m) return frame(m[1], m[2], m[3], m[4]);
  return null;
}

/**
 * Parse a stack-trace string into structured frames. Returns `undefined` when no
 * line is a recognisable frame (so the caller omits `frames` rather than emitting
 * an empty array), and never throws on malformed input.
 */
export function parseStackFrames(stack: string | undefined): StackFrame[] | undefined {
  if (!stack) return undefined;
  const frames: StackFrame[] = [];
  for (const line of stack.split('\n')) {
    const parsed = parseLine(line);
    if (parsed) frames.push(parsed);
  }
  return frames.length > 0 ? frames : undefined;
}
