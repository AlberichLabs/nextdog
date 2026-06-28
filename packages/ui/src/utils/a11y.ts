/**
 * Accessibility helpers for the overlay UI.
 *
 * The overlay uses a number of `<div>`/`<span>` elements as clickable rows,
 * list items, and sortable headers. Those are not natively keyboard-operable,
 * so we attach a real keyboard equivalent (Enter / Space activate, just like a
 * click) plus the matching ARIA role and tab stop.
 */

/** The keys that activate a button-like control. */
const ACTIVATION_KEYS = new Set(['Enter', ' ', 'Spacebar']);

/** Minimal shape of the keyboard event fields we rely on. */
interface ActivationKeyEvent {
  key: string;
  preventDefault(): void;
}

/**
 * Keyboard handler that mirrors a click on Enter/Space — the keyboard half of
 * making a non-button element operable.
 */
export function onActivateKeyDown(onActivate: () => void): (event: ActivationKeyEvent) => void {
  return (event) => {
    if (ACTIVATION_KEYS.has(event.key)) {
      event.preventDefault();
      onActivate();
    }
  };
}

export interface InteractiveProps {
  onClick: () => void;
  onKeyDown: (event: ActivationKeyEvent) => void;
}

/**
 * Click + keyboard (Enter/Space) activation for an element used as a control.
 * Pair it with an explicit `role` and `tabIndex` so assistive tech — and
 * Biome's `a11y` rules — can see the control:
 *
 *   `<div role="button" tabIndex={0} {...interactiveProps(() => open(id))}>`
 *
 * `role`/`tabIndex` are kept as literal attributes (not baked into the spread)
 * so they stay statically visible to a11y review and the linter.
 */
export function interactiveProps(onActivate: (() => void) | undefined): InteractiveProps {
  const activate = onActivate ?? (() => {});
  return { onClick: activate, onKeyDown: onActivateKeyDown(activate) };
}
