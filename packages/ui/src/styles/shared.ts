import { css } from 'styled-system/css';

/** Base pill / badge button used across toolbar, filters, toggles */
export const pillStyle = css({
  padding: '2px 10px',
  borderRadius: 'full',
  fontSize: 'sm',
  fontWeight: 500,
  border: '1px solid token(colors.border.subtle)',
  cursor: 'pointer',
  background: 'transparent',
  color: 'fg.dim',
  _hover: { background: 'surface.hover', borderColor: 'border.strong' },
  transition: 'all 0.15s ease',
});

/** Active variant — subtle raised look */
export const pillActiveStyle = css({
  background: 'surface.raised',
  borderColor: 'border.strong',
  color: 'fg.bright',
});

/** Centered "no results" / empty placeholder */
export const emptyStyle = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: '1',
  color: 'fg.dim',
  fontSize: '14px',
});

/** Sortable column header cell */
export const colHeaderStyle = css({
  position: 'relative',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: '1',
  userSelect: 'none',
  overflow: 'hidden',
  borderRight: '1px solid token(colors.border.subtle)',
  _last: {
    borderRight: 'none',
  },
  _hover: {
    color: 'fg.bright',
  },
});

/** Sort direction arrow */
export const sortIndicatorStyle = css({
  fontSize: '8px',
  opacity: '0.7',
  minWidth: '8px',
  display: 'inline-block',
});

/** Invisible drag handle on column edges */
export const colResizeStyle = css({
  position: 'absolute',
  right: '-4px',
  top: '0',
  bottom: '0',
  width: '9px',
  cursor: 'col-resize',
  zIndex: '3',
});

/** Toolbar row below the search bar */
export const toolbarStyle = css({
  py: '1',
  px: '4',
  display: 'flex',
  gap: '2',
  alignItems: 'center',
  borderBottom: '1px solid token(colors.border.subtle)',
});

/** JSON pre block used in detail panels */
export const jsonViewStyle = css({
  mt: '2',
  mx: '4',
  mb: '3',
  padding: '3',
  background: 'surface.bg',
  borderRadius: 'sm',
  fontFamily: 'mono',
  fontSize: 'sm',
  color: 'fg',
  overflowX: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  maxHeight: '300px',
  overflowY: 'auto',
});

/** margin-left: auto helper */
export const mlAutoStyle = css({
  marginLeft: 'auto',
});
