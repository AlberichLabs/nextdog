import { useCallback, useState } from 'preact/hooks';
import { css } from 'styled-system/css';
import type { SSEEvent } from '../hooks/use-sse.js';
import { extractHttpMeta } from '../utils/format.js';

/** Sensitive headers to strip in safe mode */
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-csrf-token',
  'x-api-key',
  'x-auth-token',
  'proxy-authorization',
]);

function buildCurl(event: SSEEvent, includeSensitive: boolean): string {
  const attrs = event.data.attributes;
  const { method, url } = extractHttpMeta(attrs, event.data.name);

  const parts = [`curl -X ${method}`];

  // Add headers from attributes
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('http.request.header.')) {
      const headerName = key.replace('http.request.header.', '');
      if (!includeSensitive && SENSITIVE_HEADERS.has(headerName.toLowerCase())) continue;
      parts.push(`  -H '${headerName}: ${String(value)}'`);
    }
  }

  // Add cookies if present and in full mode
  const cookies = attrs['http.request.cookies'] ?? attrs.cookie;
  if (cookies && includeSensitive) {
    parts.push(`  -b '${String(cookies)}'`);
  } else if (cookies && !includeSensitive) {
    parts.push(`  # cookies omitted (use Full mode to include)`);
  }

  // Add body if present
  const body = attrs['http.request.body'];
  if (body) {
    parts.push(`  -d '${String(body)}'`);
  }

  parts.push(`  '${url}'`);
  return parts.join(' \\\n');
}

const styles = {
  wrapper: css({
    display: 'flex',
    gap: '1',
  }),
  pill: css({
    padding: '2px 10px',
    borderRadius: 'full',
    fontSize: 'sm',
    fontWeight: 500,
    border: '1px solid token(colors.border.subtle)',
    cursor: 'pointer',
    background: 'transparent',
    color: 'fg.dim',
  }),
  pillFullDefault: css({
    padding: '2px 10px',
    borderRadius: 'full',
    fontSize: 'sm',
    fontWeight: 500,
    border: '1px solid token(colors.border.subtle)',
    cursor: 'pointer',
    background: 'transparent',
    color: 'yellow',
  }),
  pillFullCopied: css({
    padding: '2px 10px',
    borderRadius: 'full',
    fontSize: 'sm',
    fontWeight: 500,
    border: '1px solid token(colors.border.subtle)',
    cursor: 'pointer',
    background: 'transparent',
    color: 'green',
  }),
};

interface CopyCurlProps {
  event: SSEEvent;
}

export function CopyCurl({ event }: CopyCurlProps) {
  const [copied, setCopied] = useState<'safe' | 'full' | null>(null);

  const copy = useCallback(
    async (mode: 'safe' | 'full') => {
      const curl = buildCurl(event, mode === 'full');
      await navigator.clipboard.writeText(curl);
      setCopied(mode);
      setTimeout(() => setCopied(null), 2000);
    },
    [event],
  );

  return (
    <div className={styles.wrapper}>
      <button
        className={styles.pill}
        onClick={() => copy('safe')}
        title="Copy curl without cookies/auth headers"
      >
        {copied === 'safe' ? '✓ Copied' : 'Copy curl'}
      </button>
      <button
        className={copied === 'full' ? styles.pillFullCopied : styles.pillFullDefault}
        onClick={() => copy('full')}
        title="Copy curl with all headers including cookies (may contain session tokens)"
      >
        {copied === 'full' ? '✓ Copied' : 'Full'}
      </button>
    </div>
  );
}
