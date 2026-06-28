import { describe, expect, it, vi } from 'vitest';
import { interactiveProps, onActivateKeyDown } from '../a11y';

describe('interactiveProps', () => {
  it('runs the handler on click', () => {
    const onActivate = vi.fn();
    interactiveProps(onActivate).onClick();
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('activates on Enter, Space, and the legacy Spacebar key, preventing default scroll', () => {
    for (const key of ['Enter', ' ', 'Spacebar']) {
      const onActivate = vi.fn();
      const preventDefault = vi.fn();
      interactiveProps(onActivate).onKeyDown({ key, preventDefault });
      expect(onActivate).toHaveBeenCalledTimes(1);
      expect(preventDefault).toHaveBeenCalledTimes(1);
    }
  });

  it('is a no-op (no throw) when given no handler', () => {
    const props = interactiveProps(undefined);
    const preventDefault = vi.fn();
    expect(() => props.onClick()).not.toThrow();
    expect(() => props.onKeyDown({ key: 'Enter', preventDefault })).not.toThrow();
    // The Enter key still routes through the activation path (preventing scroll),
    // it simply has nothing to call.
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it('ignores other keys', () => {
    const onActivate = vi.fn();
    const preventDefault = vi.fn();
    interactiveProps(onActivate).onKeyDown({ key: 'a', preventDefault });
    expect(onActivate).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });
});

describe('onActivateKeyDown', () => {
  it('activates on Enter/Space only', () => {
    const onActivate = vi.fn();
    const preventDefault = vi.fn();
    const handler = onActivateKeyDown(onActivate);

    handler({ key: 'Escape', preventDefault });
    expect(onActivate).not.toHaveBeenCalled();

    handler({ key: 'Enter', preventDefault });
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });
});
