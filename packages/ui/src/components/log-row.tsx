import { css } from 'styled-system/css';
import type { SSEEvent } from '../hooks/use-sse.js';
import { formatTime } from '../utils/format.js';
import { runtimeTag } from './log-columns.js';

const logRowStyle = css({
  display: 'grid',
  gridTemplateColumns: '90px 50px 1fr',
  gap: '2',
  py: '1.5',
  px: '4',
  fontFamily: 'mono',
  fontSize: 'md',
  borderBottom: '1px solid token(colors.border.subtle)',
  cursor: 'pointer',
  alignItems: 'center',
  minWidth: 0,
  '& > span': {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  _hover: { background: 'surface.hover' },
});

const logRowWideStyle = css({
  gridTemplateColumns: '90px 50px 80px auto 1fr',
});

const logRowSelectedStyle = css({
  background: 'surface.hover',
  outline: '1px solid token(colors.accent)',
  outlineOffset: '-1px',
});

const logTimeStyle = css({
  color: 'fg.dim',
});

const logLevelStyle = css({
  fontSize: 'xs',
  fontWeight: 600,
  textTransform: 'uppercase',
  py: '1px',
  px: '1',
  borderRadius: 'sm',
  textAlign: 'center',
});

const logErrorStyle = css({
  color: 'red',
  background: 'rgba(225, 112, 85, 0.1)',
});

const logWarnStyle = css({
  color: 'yellow',
  background: 'rgba(253, 203, 110, 0.1)',
});

const logInfoStyle = css({
  color: 'blue',
  background: 'rgba(116, 185, 255, 0.1)',
});

const logDebugStyle = css({
  color: 'fg.dim',
  background: 'rgba(136, 136, 136, 0.1)',
});

const logMessageStyle = css({
  color: 'fg',
  wordBreak: 'break-word',
});

const serviceStyle = css({
  color: 'blue',
});

const runtimeTagStyle = css({
  fontSize: 'xs',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  padding: '1px 5px',
  borderRadius: 'sm',
  whiteSpace: 'nowrap',
});

const runtimeServerStyle = css({
  color: 'accent',
  background: 'rgba(108, 92, 231, 0.12)',
  border: '1px solid rgba(108, 92, 231, 0.25)',
});

const runtimeBrowserStyle = css({
  color: 'yellow',
  background: 'rgba(253, 203, 110, 0.12)',
  border: '1px solid rgba(253, 203, 110, 0.25)',
});

const customColStyle = css({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: '120px',
  color: 'fg.dim',
});

function levelClass(level?: string): string {
  switch (level) {
    case 'error':
      return `${logLevelStyle} ${logErrorStyle}`;
    case 'warn':
      return `${logLevelStyle} ${logWarnStyle}`;
    case 'info':
      return `${logLevelStyle} ${logInfoStyle}`;
    case 'debug':
      return `${logLevelStyle} ${logDebugStyle}`;
    default:
      return logLevelStyle;
  }
}

function runtimeTagClass(rt: string): string {
  const base = runtimeTagStyle;
  if (rt === 'server') return `${base} ${runtimeServerStyle}`;
  if (rt === 'browser') return `${base} ${runtimeBrowserStyle}`;
  return base;
}

interface LogRowProps {
  event: SSEEvent;
  selected?: boolean;
  showService?: boolean;
  onClick?: () => void;
  onCellContext?: (e: MouseEvent, key: string, value: string) => void;
  extraColumns?: { id: string; value: string; attrKey?: string }[];
  style?: string;
  /** Ref forwarded to the row element so the virtualizer can measure its height. */
  rootRef?: (el: HTMLElement | null) => void;
}

export function LogRow({
  event,
  selected,
  showService,
  onClick,
  onCellContext,
  extraColumns,
  style,
  rootRef,
}: LogRowProps) {
  const level = event.data.level ?? event.data.status?.code ?? '';
  const message = event.data.message ?? event.data.name;
  const ts = event.data.timestamp ?? event.timestamp;
  const runtime = runtimeTag(event);

  return (
    <div
      ref={rootRef}
      className={`${logRowStyle} ${showService ? logRowWideStyle : ''} ${selected ? logRowSelectedStyle : ''}`}
      onClick={onClick}
      style={style}
    >
      <span className={logTimeStyle}>{formatTime(ts)}</span>
      <span
        className={levelClass(event.data.level)}
        onContextMenu={
          onCellContext ? (e: MouseEvent) => onCellContext(e, 'level', String(level)) : undefined
        }
      >
        {level}
      </span>
      {showService && (
        <span
          className={serviceStyle}
          onContextMenu={
            onCellContext
              ? (e: MouseEvent) => onCellContext(e, 'service', event.data.serviceName)
              : undefined
          }
        >
          {event.data.serviceName}
        </span>
      )}
      {/* Always render a runtime cell so cell count matches the grid template's
          runtime track — an empty placeholder when the log has no runtime
          attribute keeps the message in its own track (issue #18). */}
      {runtime ? (
        <span className={runtimeTagClass(runtime)}>{runtime}</span>
      ) : (
        <span aria-hidden="true" />
      )}
      <span
        className={logMessageStyle}
        onContextMenu={
          onCellContext
            ? (e: MouseEvent) => onCellContext(e, 'message', String(message))
            : undefined
        }
      >
        {message}
      </span>
      {extraColumns?.map((col) => (
        <span
          key={col.id}
          className={customColStyle}
          title={col.value}
          onContextMenu={
            onCellContext && col.attrKey
              ? (e: MouseEvent) => onCellContext(e, col.attrKey!, col.value)
              : undefined
          }
        >
          {col.value || '—'}
        </span>
      ))}
    </div>
  );
}
