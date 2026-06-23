import { describe, expect, it } from 'vitest';
import {
  deriveErrorState,
  type ErrorBoundaryState,
  errorMessage,
  resetState,
} from '../error-boundary-logic.js';

describe('error-boundary-logic (issue #44)', () => {
  it('starts with no error', () => {
    const initial: ErrorBoundaryState = { error: null };
    expect(initial.error).toBeNull();
  });

  it('deriveErrorState captures the thrown error', () => {
    const err = new Error('boom');
    expect(deriveErrorState(err)).toEqual({ error: err });
  });

  it('deriveErrorState wraps a non-Error throw into an Error', () => {
    const state = deriveErrorState('a string was thrown');
    expect(state.error).toBeInstanceOf(Error);
    expect(state.error?.message).toContain('a string was thrown');
  });

  it('resetState clears the captured error', () => {
    expect(resetState()).toEqual({ error: null });
  });

  it('errorMessage returns the error message when present', () => {
    expect(errorMessage({ error: new Error('Cannot convert not-a-number to a BigInt') })).toBe(
      'Cannot convert not-a-number to a BigInt',
    );
  });

  it('errorMessage falls back to a generic message for a message-less error', () => {
    const err = new Error('');
    expect(errorMessage({ error: err })).toBe('An unexpected error occurred.');
  });
});
