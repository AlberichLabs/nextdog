import { describe, expect, it } from 'vitest';
import {
  resolveGlobalShortcut,
  resolveViewPath,
  type ShortcutEventLike,
  VIEW_PATHS,
} from '../global-shortcuts';

/** Build a minimal ShortcutEventLike; every flag defaults to "not held". */
function ev(partial: Partial<ShortcutEventLike> & { key: string }): ShortcutEventLike {
  return {
    key: partial.key,
    metaKey: partial.metaKey ?? false,
    ctrlKey: partial.ctrlKey ?? false,
    shiftKey: partial.shiftKey ?? false,
    altKey: partial.altKey ?? false,
    isComposing: partial.isComposing ?? false,
    inEditable: partial.inEditable ?? false,
  };
}

describe('resolveGlobalShortcut', () => {
  describe('focus filter', () => {
    it('maps / to focusFilter outside inputs', () => {
      expect(resolveGlobalShortcut(ev({ key: '/' }))).toBe('focusFilter');
    });

    it('does NOT map / while typing, so a literal slash reaches the input', () => {
      expect(resolveGlobalShortcut(ev({ key: '/', inEditable: true }))).toBeNull();
    });

    it('maps Cmd+K and Ctrl+K to focusFilter from anywhere, including inside an input', () => {
      expect(resolveGlobalShortcut(ev({ key: 'k', metaKey: true }))).toBe('focusFilter');
      expect(resolveGlobalShortcut(ev({ key: 'k', ctrlKey: true }))).toBe('focusFilter');
      expect(resolveGlobalShortcut(ev({ key: 'k', metaKey: true, inEditable: true }))).toBe(
        'focusFilter',
      );
      expect(resolveGlobalShortcut(ev({ key: 'K', ctrlKey: true, inEditable: true }))).toBe(
        'focusFilter',
      );
    });
  });

  describe('view switching', () => {
    it('maps [ to prevView and ] to nextView', () => {
      expect(resolveGlobalShortcut(ev({ key: '[' }))).toBe('prevView');
      expect(resolveGlobalShortcut(ev({ key: ']' }))).toBe('nextView');
    });

    it('does NOT switch views while typing in the filter', () => {
      expect(resolveGlobalShortcut(ev({ key: '[', inEditable: true }))).toBeNull();
      expect(resolveGlobalShortcut(ev({ key: ']', inEditable: true }))).toBeNull();
    });
  });

  describe('clear filter', () => {
    it('maps Shift+X to clearFilter', () => {
      expect(resolveGlobalShortcut(ev({ key: 'X', shiftKey: true }))).toBe('clearFilter');
    });

    it('does not treat a bare x as clearFilter', () => {
      expect(resolveGlobalShortcut(ev({ key: 'x' }))).toBeNull();
    });

    it('does NOT clear while typing in the filter', () => {
      expect(resolveGlobalShortcut(ev({ key: 'X', shiftKey: true, inEditable: true }))).toBeNull();
    });
  });

  describe('guardrails against swallowing host/browser keybindings', () => {
    it('leaves the existing j/k/Enter/Esc nav keys to the per-view hook', () => {
      for (const key of ['j', 'k', 'Enter', 'Escape', '?']) {
        expect(resolveGlobalShortcut(ev({ key }))).toBeNull();
      }
    });

    it('ignores plain bindings when a modifier is held (Cmd+[ is browser Back)', () => {
      expect(resolveGlobalShortcut(ev({ key: '[', metaKey: true }))).toBeNull();
      expect(resolveGlobalShortcut(ev({ key: ']', metaKey: true }))).toBeNull();
      expect(resolveGlobalShortcut(ev({ key: '[', ctrlKey: true }))).toBeNull();
      expect(resolveGlobalShortcut(ev({ key: ']', altKey: true }))).toBeNull();
      expect(resolveGlobalShortcut(ev({ key: '/', metaKey: true }))).toBeNull();
      expect(resolveGlobalShortcut(ev({ key: 'X', shiftKey: true, metaKey: true }))).toBeNull();
    });

    it('ignores everything mid-IME-composition, including Cmd/Ctrl+K', () => {
      expect(resolveGlobalShortcut(ev({ key: '/', isComposing: true }))).toBeNull();
      expect(resolveGlobalShortcut(ev({ key: 'k', metaKey: true, isComposing: true }))).toBeNull();
    });

    it('returns null for unrelated keys so their default action survives', () => {
      for (const key of ['a', 'F5', 'Tab', 'ArrowDown', 'r']) {
        expect(resolveGlobalShortcut(ev({ key }))).toBeNull();
      }
    });
  });
});

describe('resolveViewPath', () => {
  it('exposes the three list views in nav order', () => {
    expect(VIEW_PATHS).toEqual(['/', '/traces', '/logs']);
  });

  it('steps forward through Spans -> Traces -> Logs', () => {
    expect(resolveViewPath('/', 1)).toBe('/traces');
    expect(resolveViewPath('/traces', 1)).toBe('/logs');
  });

  it('steps backward through Logs -> Traces -> Spans', () => {
    expect(resolveViewPath('/logs', -1)).toBe('/traces');
    expect(resolveViewPath('/traces', -1)).toBe('/');
  });

  it('wraps around at both ends', () => {
    expect(resolveViewPath('/logs', 1)).toBe('/');
    expect(resolveViewPath('/', -1)).toBe('/logs');
  });

  it('returns to Spans from a non-list route such as the trace detail page', () => {
    expect(resolveViewPath('/trace/abc123', 1)).toBe('/');
    expect(resolveViewPath('/trace/abc123', -1)).toBe('/');
    expect(resolveViewPath('/something-else', 1)).toBe('/');
  });
});
