import { css } from 'styled-system/css';
import { selectEmptyState } from './empty-state-logic';

interface EmptyStateProps {
  /** SSE connection established. */
  connected: boolean;
  /**
   * Have we ever received an event this session? Latches true on the first
   * event and survives a manual Clear, so we can tell "connected but no traffic
   * yet" apart from "connected, you cleared the list".
   */
  everReceived?: boolean;
  /**
   * Base URL of the sidecar (used to link the verify step at GET /health).
   * Optional so existing call sites and tests keep working.
   */
  sidecarUrl?: string;
}

const containerStyle = css({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  width: '100%',
  gap: '4',
});

const headlineStyle = css({
  fontSize: 'xl',
  color: 'fg.dim',
});

const checklistStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '1',
  fontSize: 'lg',
  color: 'fg.dim',
});

const footnoteStyle = css({
  fontSize: 'sm',
  fontStyle: 'italic',
  color: 'fg.dim',
});

const healthLinkStyle = css({
  color: 'accent',
  textDecoration: 'underline',
  cursor: 'pointer',
  _hover: { color: 'fg.bright' },
});

export function EmptyState({ connected, everReceived = false, sidecarUrl }: EmptyStateProps) {
  // The overlay only renders when there are no visible events and no filter to
  // blame, so it resolves to exactly the "disconnected" or "connected-idle"
  // branches. (The "filter-empty" branch is rendered inline by the list views.)
  const kind = selectEmptyState({
    connected,
    everReceived,
    filterActive: false,
    hasVisibleEvents: false,
  });

  if (kind === 'connected-idle') {
    return (
      <div className={containerStyle}>
        <div className={css({ fontSize: '48px', lineHeight: '1' })}>🐾</div>

        <div className={css({ fontSize: 'xl', color: 'fg.bright', fontWeight: 600 })}>
          NextDog is connected
        </div>

        <div
          className={css({
            fontSize: 'lg',
            color: 'fg.dim',
            textAlign: 'center',
            maxWidth: '420px',
          })}
        >
          Make a request to your app to see your first trace.
        </div>

        <div className={footnoteStyle}>Waiting for your first event…</div>
      </div>
    );
  }

  // kind === 'disconnected' — setup not done / sidecar unreachable.
  return (
    <div className={containerStyle}>
      <div className={css({ fontSize: '48px', lineHeight: '1' })}>🐾</div>

      <div className={headlineStyle}>Connecting to sidecar…</div>

      <div className={checklistStyle}>
        <div>✓ Add withNextDog() to next.config.js</div>
        <div>✓ Add register() to instrumentation.ts</div>
        <div>✓ Run npm run dev</div>
        <div>
          ○ Waiting for sidecar on :6789
          {sidecarUrl && (
            <>
              {' — '}
              <a
                href={`${sidecarUrl}/health`}
                target="_blank"
                rel="noreferrer"
                className={healthLinkStyle}
              >
                verify /health
              </a>
            </>
          )}
        </div>
      </div>

      <div className={footnoteStyle}>Events will appear here automatically</div>
    </div>
  );
}
