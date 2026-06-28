import { css } from 'styled-system/css';
import { attrContextActions, showContextMenu } from './context-menu';

const attrTableStyle = css({
  fontSize: 'md',
  py: '1',
  px: '0',
  width: '100%',
  '& table': {
    width: '100%',
    borderCollapse: 'collapse',
  },
  '& tr': {
    borderBottom: '1px solid token(colors.border.subtle)',
  },
  '& tr:last-child': {
    borderBottom: 'none',
  },
});

const attrTableTitleStyle = css({
  fontWeight: '600',
  color: 'fg.dim',
  fontSize: 'xs',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  py: '2',
  px: '0',
  marginBottom: '0.5',
});

const attrKeyStyle = css({
  color: 'fg.dim',
  whiteSpace: 'nowrap',
  fontFamily: 'mono',
  fontSize: 'sm',
  py: '2',
  px: '0',
  paddingRight: '6',
  verticalAlign: 'top',
  width: '1%',
});

const attrValueStyle = css({
  color: 'fg',
  fontFamily: 'mono',
  fontSize: 'sm',
  py: '2',
  px: '0',
  wordBreak: 'break-all',
  verticalAlign: 'top',
});

const attrValueFilterableStyle = css({
  cursor: 'pointer',
  color: 'fg',
  borderBottom: '1px dashed token(colors.border.strong)',
  transition: 'all 0.15s ease',
  _hover: {
    color: 'accent',
    borderColor: 'accent',
  },
});

const attrValueLongStyle = css({
  '& pre': {
    margin: 0,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    fontFamily: 'mono',
    fontSize: 'sm',
    maxHeight: '200px',
    overflow: 'auto',
  },
});

interface AttributeTableProps {
  attributes: Record<string, unknown>;
  title?: string;
  onFilter?: (key: string, value: string) => void;
  onAddColumn?: (attrKey: string) => void;
  onRemoveColumn?: (attrKey: string) => void;
  activeColumns?: Set<string>;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function isLongValue(value: unknown): boolean {
  const str = formatValue(value);
  return str.length > 80 || str.includes('\n');
}

function isFilterable(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'object') return false;
  return String(value).length > 0 && String(value).length < 100;
}

export function AttributeTable({
  attributes,
  title,
  onFilter,
  onAddColumn,
  onRemoveColumn,
  activeColumns,
}: AttributeTableProps) {
  const entries = Object.entries(attributes).filter(([_, v]) => v !== undefined && v !== '');
  if (entries.length === 0) return null;

  const handleContextMenu = (e: MouseEvent, key: string, value: string) => {
    if (!onFilter) return;
    e.preventDefault();
    const actions = attrContextActions(key, value, {
      onFilter: (q) => onFilter(key, q),
      onAddColumn,
      onRemoveColumn: onRemoveColumn ? () => onRemoveColumn(key) : undefined,
      isColumnActive: activeColumns?.has(key),
    });
    showContextMenu(e.clientX, e.clientY, actions);
  };

  return (
    <div className={attrTableStyle}>
      {title && <div className={attrTableTitleStyle}>{title}</div>}
      <table>
        <tbody>
          {entries.map(([key, value]) => (
            <tr key={key}>
              <td className={attrKeyStyle}>{key}</td>
              <td className={`${attrValueStyle} ${isLongValue(value) ? attrValueLongStyle : ''}`}>
                {isLongValue(value) ? (
                  <pre>{formatValue(value)}</pre>
                ) : onFilter && isFilterable(value) ? (
                  <span
                    className={attrValueFilterableStyle}
                    onClick={() => onFilter(key, String(value))}
                    onContextMenu={(e: MouseEvent) => handleContextMenu(e, key, String(value))}
                    title={`Left-click to filter, right-click for options`}
                  >
                    {formatValue(value)}
                  </span>
                ) : (
                  formatValue(value)
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
