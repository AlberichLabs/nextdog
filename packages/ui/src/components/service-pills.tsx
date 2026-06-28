import { useMemo } from 'preact/hooks';
import { css } from 'styled-system/css';
import type { SSEEvent } from '../hooks/use-sse';
import { pillActiveStyle, pillStyle } from '../styles/shared';

const servicePillsStyle = css({
  display: 'flex',
  gap: '6px',
  py: '2',
  px: '4',
  borderBottom: '1px solid token(colors.border.subtle)',
  flexWrap: 'wrap',
});

const pillErrorDotStyle = css({
  display: 'inline-block',
  width: '6px',
  height: '6px',
  borderRadius: '50%',
  background: 'red',
  marginLeft: '1',
  verticalAlign: 'middle',
});

interface ServicePillsProps {
  services: string[];
  active: Set<string>;
  onToggle: (name: string) => void;
  events?: SSEEvent[];
}

interface ServiceStats {
  total: number;
  errors: number;
}

export function ServicePills({ services, active, onToggle, events }: ServicePillsProps) {
  // NOTE: hooks must run on every render (Rules of Hooks), so useMemo comes
  // before the early `services.length === 0` return — otherwise the hook order
  // changes as services toggle between empty/non-empty and corrupts hook state.
  const stats = useMemo(() => {
    const map = new Map<string, ServiceStats>();
    if (!events) return map;
    for (const e of events) {
      const name = e.data.serviceName;
      let s = map.get(name);
      if (!s) {
        s = { total: 0, errors: 0 };
        map.set(name, s);
      }
      s.total++;
      if (e.data.status?.code === 'ERROR' || (e.data.statusCode && e.data.statusCode >= 500)) {
        s.errors++;
      }
    }
    return map;
  }, [events]);

  if (services.length === 0) return null;

  return (
    <div className={servicePillsStyle}>
      {services.map((name) => {
        const s = stats.get(name);
        const errorCount = s ? s.errors : 0;
        return (
          <button
            type="button"
            key={name}
            className={`${pillStyle} ${active.has(name) ? pillActiveStyle : ''}`}
            onClick={() => onToggle(name)}
          >
            {name}
            {errorCount > 0 && (
              <span className={pillErrorDotStyle} title={`${errorCount} errors`} />
            )}
          </button>
        );
      })}
    </div>
  );
}
