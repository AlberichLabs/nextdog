import { css } from 'styled-system/css';
import { buildResponseSection, formatBody } from '../utils/body-format';

const statusGreen = css({ color: 'green', fontWeight: 600 });
const statusYellow = css({ color: 'yellow', fontWeight: 600 });
const statusRed = css({ color: 'red', fontWeight: 600 });

function StatusBadge({ status }: { status: number }) {
  const style = status < 300 ? statusGreen : status < 400 ? statusYellow : statusRed;
  return <span className={style}>{status}</span>;
}

const container = css({
  border: '1px solid token(colors.border.subtle)',
  borderRadius: 'md',
  overflow: 'hidden',
  margin: '3',
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

const emptyBody = css({
  py: '2',
  px: '3',
  fontFamily: 'mono',
  fontSize: 'sm',
  color: 'fg.dim',
  fontStyle: 'italic',
});

interface ResponseSectionProps {
  attributes: Record<string, unknown>;
}

/**
 * Renders the ACTUAL response (status, headers, pretty-printed body) captured on
 * the original server span — distinct from Replay, which re-runs the request.
 * Returns null when the span has no captured response.
 */
export function ResponseSection({ attributes }: ResponseSectionProps) {
  const response = buildResponseSection(attributes);
  if (!response) return null;

  const headerEntries = Object.entries(response.headers);

  return (
    <div className={container}>
      {/* Status bar */}
      <div className={headerBar}>
        {response.status !== undefined ? (
          <StatusBadge status={response.status} />
        ) : (
          <span className={dimText}>—</span>
        )}
        <span className={dimText}>response</span>
      </div>

      {/* Response headers (collapsed by default) */}
      {headerEntries.length > 0 && (
        <details className={detailsStyle}>
          <summary className={summaryStyle}>Response Headers ({headerEntries.length})</summary>
          <div className={headersContent}>
            {headerEntries.map(([k, v]) => (
              <div key={k} className={headerRow}>
                <span className={headerKey}>{k}</span>: {v}
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Response body */}
      {response.body !== undefined ? (
        <pre className={bodyPre}>{formatBody(response.body, response.contentType)}</pre>
      ) : (
        <div className={emptyBody}>(no response body)</div>
      )}
    </div>
  );
}
