import { useEffect, useState } from 'preact/hooks';

/**
 * Viewports at/below this width are treated as "narrow" and hide low-priority
 * table columns so the primary identifier (Route / Message) keeps usable width
 * instead of clipping to ~0 (issue #50). Covers small phones (e.g. a 390px
 * logical-width device) with headroom.
 */
export const NARROW_MAX_WIDTH = 480;

/** True when the viewport is at/below `maxWidth`. Updates on resize. */
export function useIsNarrow(maxWidth = NARROW_MAX_WIDTH): boolean {
  const query = `(max-width: ${maxWidth}px)`;
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = () => setNarrow(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return narrow;
}
