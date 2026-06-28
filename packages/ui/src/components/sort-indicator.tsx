import { sortIndicatorStyle } from '../styles/shared';

interface SortIndicatorProps {
  field: string;
  sortBy: string;
  sortDir: 'asc' | 'desc';
}

export function SortIndicator({ field, sortBy, sortDir }: SortIndicatorProps) {
  if (field !== sortBy) return <span className={sortIndicatorStyle} />;
  return <span className={sortIndicatorStyle}>{sortDir === 'asc' ? '\u25B2' : '\u25BC'}</span>;
}
