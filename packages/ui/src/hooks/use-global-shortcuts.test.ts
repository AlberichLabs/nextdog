import { describe, it, expect } from 'vitest';
import { resolveGlobalShortcut } from './use-global-shortcuts.js';

const ev = (over: Record<string, unknown>) => ({
  key: '',
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  target: null,
  ...over,
});

describe('resolveGlobalShortcut', () => {
  it('focuses the filter on /', () => {
    expect(resolveGlobalShortcut(ev({ key: '/' }))).toBe('focusFilter');
  });

  it('focuses the filter on Cmd+K and Ctrl+K', () => {
    expect(resolveGlobalShortcut(ev({ key: 'k', metaKey: true }))).toBe('focusFilter');
    expect(resolveGlobalShortcut(ev({ key: 'k', ctrlKey: true }))).toBe('focusFilter');
    expect(resolveGlobalShortcut(ev({ key: 'K', metaKey: true, shiftKey: true }))).toBe('focusFilter');
  });

  it('switches views on [ and ]', () => {
    expect(resolveGlobalShortcut(ev({ key: '[' }))).toBe('prevView');
    expect(resolveGlobalShortcut(ev({ key: ']' }))).toBe('nextView');
  });

  it('clears the filter on Shift+X', () => {
    expect(resolveGlobalShortcut(ev({ key: 'X', shiftKey: true }))).toBe('clearFilter');
  });

  it('suppresses plain bindings while typing in an input or textarea', () => {
    expect(resolveGlobalShortcut(ev({ key: '/', target: { tagName: 'INPUT' } }))).toBeNull();
    expect(resolveGlobalShortcut(ev({ key: '[', target: { tagName: 'INPUT' } }))).toBeNull();
    expect(resolveGlobalShortcut(ev({ key: 'X', shiftKey: true, target: { tagName: 'TEXTAREA' } }))).toBeNull();
  });

  it('still honors Cmd/Ctrl+K while typing in an input', () => {
    expect(resolveGlobalShortcut(ev({ key: 'k', metaKey: true, target: { tagName: 'INPUT' } }))).toBe('focusFilter');
  });

  it('ignores unrelated keys and bare x', () => {
    expect(resolveGlobalShortcut(ev({ key: 'j' }))).toBeNull();
    expect(resolveGlobalShortcut(ev({ key: 'x' }))).toBeNull();
  });

  it('ignores view-switch keys when a modifier is held', () => {
    expect(resolveGlobalShortcut(ev({ key: '[', ctrlKey: true }))).toBeNull();
    expect(resolveGlobalShortcut(ev({ key: ']', altKey: true }))).toBeNull();
  });
});
