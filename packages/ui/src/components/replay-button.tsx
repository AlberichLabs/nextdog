import { useCallback, useState } from 'preact/hooks';
import { css } from 'styled-system/css';
import type { SSEEvent } from '../hooks/use-sse';
import { formatBody } from '../utils/body-format';

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

type ReplayState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'success'; data: ReplayResponse }
  | { phase: 'error'; data: ReplayError };

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

interface ReplayButtonProps {
  event: SSEEvent;
}

export function ReplayButton({ event }: ReplayButtonProps) {
  const [state, setState] = useState<ReplayState>({ phase: 'idle' });

  const replay = useCallback(async () => {
    setState({ phase: 'loading' });

    try {
      const res = await fetch('/api/replay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spanId: event.data.spanId }),
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
  }, [event]);

  return (
    <div>
      <button
        type="button"
        className={pillButton}
        onClick={replay}
        disabled={state.phase === 'loading'}
        style={{ opacity: state.phase === 'loading' ? 0.6 : 1 }}
      >
        {state.phase === 'loading' ? 'Replaying...' : 'Replay'}
      </button>

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
