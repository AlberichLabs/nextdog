import { describe, it, expect } from 'vitest';
import { resolveKeyAction, type KeyEventLike } from '../keymap.js';

/** Build a minimal KeyEventLike for tests. */
function ev(partial: Partial<KeyEventLike> & { key: string }): KeyEventLike {
  return {
    key: partial.key,
    metaKey: partial.metaKey ?? false,
    ctrlKey: partial.ctrlKey ?? false,
    shiftKey: partial.shiftKey ?? false,
    altKey: partial.altKey ?? false,
    inEditable: partial.inEditable ?? false,
  };
}

describe('resolveKeyAction', () => {
  describe('navigation (existing behavior, must not regress)', () => {
    it('maps j -> next', () => {
      expect(resolveKeyAction(ev({ key: 'j' }))).toBe('next');
    });
    it('maps k -> prev', () => {
      expect(resolveKeyAction(ev({ key: 'k' }))).toBe('prev');
    });
    it('maps Enter -> select', () => {
      expect(resolveKeyAction(ev({ key: 'Enter' }))).toBe('select');
    });
    it('maps Escape -> back', () => {
      expect(resolveKeyAction(ev({ key: 'Escape' }))).toBe('back');
    });

    it('ignores j/k/Enter when focus is in an editable element', () => {
      expect(resolveKeyAction(ev({ key: 'j', inEditable: true }))).toBeNull();
      expect(resolveKeyAction(ev({ key: 'k', inEditable: true }))).toBeNull();
      expect(resolveKeyAction(ev({ key: 'Enter', inEditable: true }))).toBeNull();
    });

    it('ignores Escape inside an editable element (search bar owns its own Esc)', () => {
      expect(resolveKeyAction(ev({ key: 'Escape', inEditable: true }))).toBeNull();
    });

    it('does not fire navigation when a modifier is held', () => {
      // (cmd/ctrl+k is the one deliberate modifier binding; j is plain-only.)
      expect(resolveKeyAction(ev({ key: 'j', metaKey: true }))).toBeNull();
      expect(resolveKeyAction(ev({ key: 'j', ctrlKey: true }))).toBeNull();
      expect(resolveKeyAction(ev({ key: 'k', altKey: true }))).toBeNull();
    });
  });

  describe('focus filter', () => {
    it('maps / -> focusFilter when not in an editable element', () => {
      expect(resolveKeyAction(ev({ key: '/' }))).toBe('focusFilter');
    });

    it('does NOT map / when focus is already in an editable element (typing a slash)', () => {
      expect(resolveKeyAction(ev({ key: '/', inEditable: true }))).toBeNull();
    });

    it('maps cmd+k -> focusFilter from anywhere (including inside inputs)', () => {
      expect(resolveKeyAction(ev({ key: 'k', metaKey: true }))).toBe('focusFilter');
      expect(resolveKeyAction(ev({ key: 'k', metaKey: true, inEditable: true }))).toBe('focusFilter');
    });

    it('maps ctrl+k -> focusFilter from anywhere', () => {
      expect(resolveKeyAction(ev({ key: 'k', ctrlKey: true }))).toBe('focusFilter');
      expect(resolveKeyAction(ev({ key: 'K', ctrlKey: true, inEditable: true }))).toBe('focusFilter');
    });
  });

  describe('view switching', () => {
    it('maps [ -> viewSpans', () => {
      expect(resolveKeyAction(ev({ key: '[' }))).toBe('viewSpans');
    });
    it('maps ] -> viewLogs', () => {
      expect(resolveKeyAction(ev({ key: ']' }))).toBe('viewLogs');
    });
    it('does NOT switch views while typing in the filter', () => {
      expect(resolveKeyAction(ev({ key: '[', inEditable: true }))).toBeNull();
      expect(resolveKeyAction(ev({ key: ']', inEditable: true }))).toBeNull();
    });
  });

  describe('clear filter', () => {
    it('maps shift+x (X) -> clearFilter', () => {
      expect(resolveKeyAction(ev({ key: 'X', shiftKey: true }))).toBe('clearFilter');
    });
    it('does NOT clear while typing in the filter', () => {
      expect(resolveKeyAction(ev({ key: 'X', shiftKey: true, inEditable: true }))).toBeNull();
    });
    it('does not treat a plain x as clear', () => {
      expect(resolveKeyAction(ev({ key: 'x' }))).toBeNull();
    });
  });
});
