import { useCallback, useState } from 'preact/hooks';
import { css } from 'styled-system/css';
import type { SSEEvent } from '../hooks/use-sse';
import { formatBody } from '../utils/body-format';
import { composeReplayHeaders, formatHeaderLines, splitAuthHeader } from '../utils/replay-headers';

interface ReplayResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  duration: number;
  url: string;
  method: string;
}

interface ReplayError {
  error: string;
  message: string;
  url: string;
  method: string;
}

/** Reconstructed request the sidecar hands back for the editor to pre-fill. */
interface PreparedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

type ReplayState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'success'; data: ReplayResponse }
  | { phase: 'error'; data: ReplayError };

/**
 * Editable copy of the request, shown before sending so the user can override
 * the captured Authorization header (e.g. when it has expired) or tweak anything
 * else. The captured token is pre-filled here; any edit lives only in component
 * state and is never persisted (issue #60).
 */
interface EditorState {
  loading: boolean; // fetching the prefill from the sidecar
  prepareError?: string;
  method: string;
  url: string;
  authorization: string;
  headersText: string; // non-auth headers, one "Key: Value" per line
  body: string;
  sending: boolean;
}

const statusGreen = css({ color: 'green', fontWeight: 600 });
const statusYellow = css({ color: 'yellow', fontWeight: 600 });
const statusRed = css({ color: 'red', fontWeight: 600 });

function StatusBadge({ status }: { status: number }) {
  const style = status < 300 ? statusGreen : status < 400 ? statusYellow : statusRed;
  return <span className={style}>{status}</span>;
}

const pillButton = css({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '1',
  py: '1',
  px: '2',
  borderRadius: 'sm',
  border: '1px solid token(colors.border.strong)',
  fontSize: 'sm',
  fontFamily: 'mono',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  background: 'transparent',
  color: 'fg.dim',
  fontWeight: 500,
  transition: 'all 0.15s ease',
  _hover: {
    background: 'surface.hover',
    color: 'fg.bright',
    borderColor: 'fg.dim',
  },
});

const resultContainer = css({
  marginTop: '2',
  border: '1px solid token(colors.border.subtle)',
  borderRadius: 'md',
  overflow: 'hidden',
});

const headerBar = css({
  display: 'flex',
  alignItems: 'center',
  gap: '2',
  py: '2',
  px: '3',
  background: 'surface.panel',
  borderBottom: '1px solid token(colors.border.subtle)',
  fontFamily: 'mono',
  fontSize: 'sm',
});

const dimText = css({ color: 'fg.dim' });

const detailsStyle = css({
  borderBottom: '1px solid token(colors.border.subtle)',
});

const summaryStyle = css({
  py: '1',
  px: '3',
  fontSize: 'sm',
  color: 'fg.dim',
  cursor: 'pointer',
  userSelect: 'none',
});

const headersContent = css({
  pt: '1',
  px: '3',
  pb: '2',
  fontFamily: 'mono',
  fontSize: 'sm',
});

const headerKey = css({ color: 'fg' });
const headerRow = css({ color: 'fg.dim' });

const bodyPre = css({
  margin: 0,
  padding: '3',
  fontFamily: 'mono',
  fontSize: 'sm',
  maxHeight: '400px',
  overflow: 'auto',
  color: 'fg',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
});

const errorContainer = css({
  marginTop: '2',
  py: '2',
  px: '3',
  border: '1px solid token(colors.red)',
  borderRadius: 'md',
  fontFamily: 'mono',
  fontSize: 'sm',
  color: 'red',
});

const errorTitle = css({ fontWeight: 600 });

const errorDetail = css({
  color: 'fg.dim',
  marginTop: '1',
});

const buttonRow = css({
  display: 'flex',
  alignItems: 'center',
  gap: '2',
});

const editorPanel = css({
  marginTop: '2',
  border: '1px solid token(colors.border.subtle)',
  borderRadius: 'md',
  background: 'surface.panel',
  p: '3',
  display: 'flex',
  flexDirection: 'column',
  gap: '2',
});

const fieldLabel = css({
  display: 'block',
  fontSize: 'xs',
  color: 'fg.dim',
  fontFamily: 'mono',
  mb: '1',
});

const textInput = css({
  width: '100%',
  py: '1',
  px: '2',
  borderRadius: 'sm',
  border: '1px solid token(colors.border.strong)',
  background: 'surface.base',
  color: 'fg',
  fontFamily: 'mono',
  fontSize: 'sm',
  _focus: { outline: 'none', borderColor: 'fg.dim' },
});

const textArea = css({
  width: '100%',
  minHeight: '60px',
  py: '1',
  px: '2',
  borderRadius: 'sm',
  border: '1px solid token(colors.border.strong)',
  background: 'surface.base',
  color: 'fg',
  fontFamily: 'mono',
  fontSize: 'sm',
  resize: 'vertical',
  _focus: { outline: 'none', borderColor: 'fg.dim' },
});

const editorHint = css({
  fontSize: 'xs',
  color: 'fg.dim',
});

const editorActions = css({
  display: 'flex',
  alignItems: 'center',
  gap: '2',
  mt: '1',
});

interface ReplayButtonProps {
  event: SSEEvent;
}

export function ReplayButton({ event }: ReplayButtonProps) {
  const [state, setState] = useState<ReplayState>({ phase: 'idle' });
  const [editor, setEditor] = useState<EditorState | null>(null);
  const spanId = event.data.spanId;

  const replay = useCallback(async () => {
    setState({ phase: 'loading' });

    try {
      const res = await fetch('/api/replay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spanId }),
      });

      const data = await res.json();

      if (res.ok) {
        setState({ phase: 'success', data: data as ReplayResponse });
      } else {
        setState({ phase: 'error', data: data as ReplayError });
      }
    } catch (err) {
      setState({
        phase: 'error',
        data: {
          error: 'network error',
          message: (err as Error).message,
          url: '',
          method: '',
        },
      });
    }
  }, [spanId]);

  // Open the editor: ask the sidecar to reconstruct the captured request (method,
  // URL, headers incl. the captured Authorization, body) so we can pre-fill the
  // form. prepareOnly means it is NOT sent — the user reviews/edits first.
  const openEditor = useCallback(async () => {
    setState({ phase: 'idle' });
    setEditor({
      loading: true,
      method: '',
      url: '',
      authorization: '',
      headersText: '',
      body: '',
      sending: false,
    });

    try {
      const res = await fetch('/api/replay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spanId, prepareOnly: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEditor({
          loading: false,
          prepareError: (data as ReplayError).message ?? 'could not prepare request',
          method: '',
          url: '',
          authorization: '',
          headersText: '',
          body: '',
          sending: false,
        });
        return;
      }
      const prepared = data as PreparedRequest;
      const { authorization, rest } = splitAuthHeader(prepared.headers ?? {});
      setEditor({
        loading: false,
        method: prepared.method,
        url: prepared.url,
        authorization,
        headersText: formatHeaderLines(rest),
        body: prepared.body ?? '',
        sending: false,
      });
    } catch (err) {
      setEditor({
        loading: false,
        prepareError: (err as Error).message,
        method: '',
        url: '',
        authorization: '',
        headersText: '',
        body: '',
        sending: false,
      });
    }
  }, [spanId]);

  // Send the edited request verbatim. The composed headers (including any pasted
  // Authorization) travel only in this request body — the sidecar never writes
  // them to disk (issue #60).
  const sendEdited = useCallback(async () => {
    if (!editor) return;
    const headers = composeReplayHeaders(editor.headersText, editor.authorization);
    setEditor((e) => (e ? { ...e, sending: true } : e));
    setState({ phase: 'loading' });

    try {
      const res = await fetch('/api/replay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request: {
            method: editor.method,
            url: editor.url,
            headers,
            body: editor.body ? editor.body : undefined,
          },
        }),
      });
      const data = await res.json();
      setEditor((e) => (e ? { ...e, sending: false } : e));
      if (res.ok) {
        setState({ phase: 'success', data: data as ReplayResponse });
      } else {
        setState({ phase: 'error', data: data as ReplayError });
      }
    } catch (err) {
      setEditor((e) => (e ? { ...e, sending: false } : e));
      setState({
        phase: 'error',
        data: { error: 'network error', message: (err as Error).message, url: '', method: '' },
      });
    }
  }, [editor]);

  const updateEditor = useCallback((patch: Partial<EditorState>) => {
    setEditor((e) => (e ? { ...e, ...patch } : e));
  }, []);

  return (
    <div>
      <div className={buttonRow}>
        <button
          type="button"
          className={pillButton}
          onClick={replay}
          disabled={state.phase === 'loading'}
          style={{ opacity: state.phase === 'loading' ? 0.6 : 1 }}
        >
          {state.phase === 'loading' && !editor?.sending ? 'Replaying...' : 'Replay'}
        </button>
        <button
          type="button"
          className={pillButton}
          onClick={editor ? () => setEditor(null) : openEditor}
          title="Edit headers (e.g. add an Authorization token) before sending"
        >
          {editor ? 'Close editor' : 'Edit & Replay'}
        </button>
      </div>

      {editor && (
        <div className={editorPanel}>
          {editor.loading ? (
            <span className={dimText}>Preparing request…</span>
          ) : editor.prepareError ? (
            <div className={errorContainer}>
              <div className={errorTitle}>Could not prepare request</div>
              <div className={errorDetail}>{editor.prepareError}</div>
            </div>
          ) : (
            <>
              <div className={css({ display: 'flex', gap: '2' })}>
                <div className={css({ flexShrink: 0, width: '80px' })}>
                  <label className={fieldLabel}>
                    Method
                    <input
                      className={textInput}
                      value={editor.method}
                      onInput={(e) => updateEditor({ method: e.currentTarget.value })}
                    />
                  </label>
                </div>
                <div className={css({ flex: 1 })}>
                  <label className={fieldLabel}>
                    URL
                    <input
                      className={textInput}
                      value={editor.url}
                      onInput={(e) => updateEditor({ url: e.currentTarget.value })}
                    />
                  </label>
                </div>
              </div>
              <label className={fieldLabel}>
                Authorization
                <input
                  className={textInput}
                  value={editor.authorization}
                  placeholder="e.g. Bearer eyJ… (overrides the captured token for this replay)"
                  onInput={(e) => updateEditor({ authorization: e.currentTarget.value })}
                />
              </label>
              <div className={editorHint}>
                The captured token is pre-filled and one-click Replay re-sends it. Override it here
                (e.g. if it has expired); your edit lives only for this send and is never stored.
              </div>
              <label className={fieldLabel}>
                Other headers (one “Key: Value” per line)
                <textarea
                  className={textArea}
                  value={editor.headersText}
                  onInput={(e) => updateEditor({ headersText: e.currentTarget.value })}
                />
              </label>
              <label className={fieldLabel}>
                Body
                <textarea
                  className={textArea}
                  value={editor.body}
                  onInput={(e) => updateEditor({ body: e.currentTarget.value })}
                />
              </label>

              <div className={editorActions}>
                <button
                  type="button"
                  className={pillButton}
                  onClick={sendEdited}
                  disabled={editor.sending}
                  style={{ opacity: editor.sending ? 0.6 : 1 }}
                >
                  {editor.sending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {(state.phase === 'success' || state.phase === 'error') && (
        <button
          type="button"
          onClick={() => setState({ phase: 'idle' })}
          className={css({
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '20px',
            height: '20px',
            border: 'none',
            borderRadius: 'sm',
            background: 'transparent',
            color: 'fg.dim',
            cursor: 'pointer',
            position: 'absolute',
            top: '2',
            right: '2',
            _hover: { color: 'fg.bright', background: 'surface.hover' },
          })}
          title="Dismiss"
        >
          <svg
            aria-hidden="true"
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}

      {state.phase === 'success' && (
        <div className={resultContainer} style={{ position: 'relative' }}>
          {/* Response header bar */}
          <div className={headerBar}>
            <StatusBadge status={state.data.status} />
            <span className={dimText}>{state.data.statusText}</span>
            <span className={dimText}>|</span>
            <span className={dimText}>{state.data.duration}ms</span>
            <span className={dimText}>|</span>
            <span className={dimText}>
              {state.data.method} {state.data.url}
            </span>
          </div>

          {/* Response headers (collapsed by default) */}
          <details className={detailsStyle}>
            <summary className={summaryStyle}>
              Response Headers ({Object.keys(state.data.headers).length})
            </summary>
            <div className={headersContent}>
              {Object.entries(state.data.headers).map(([k, v]) => (
                <div key={k} className={headerRow}>
                  <span className={headerKey}>{k}</span>: {v}
                </div>
              ))}
            </div>
          </details>

          {/* Response body */}
          <pre className={bodyPre}>
            {formatBody(state.data.body, state.data.headers['content-type'] ?? '')}
          </pre>
        </div>
      )}

      {state.phase === 'error' && (
        <div className={errorContainer}>
          <div className={errorTitle}>Replay failed</div>
          <div className={errorDetail}>{state.data.message}</div>
          {state.data.url && (
            <div className={errorDetail}>
              {state.data.method} {state.data.url}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
