import { describe, expect, it } from 'vitest';
import {
  composeReplayHeaders,
  formatHeaderLines,
  parseHeaderLines,
  splitAuthHeader,
} from '../replay-headers';

describe('parseHeaderLines', () => {
  it('parses "Key: Value" lines into an object', () => {
    expect(parseHeaderLines('Content-Type: application/json\nAccept: */*')).toEqual({
      'Content-Type': 'application/json',
      Accept: '*/*',
    });
  });

  it('keeps colons inside the value (e.g. Host: localhost:3000)', () => {
    expect(parseHeaderLines('Host: localhost:3000')).toEqual({ Host: 'localhost:3000' });
  });

  it('skips blank lines and lines without a colon', () => {
    expect(parseHeaderLines('\nAccept: */*\n   \ngarbage\n')).toEqual({ Accept: '*/*' });
  });
});

describe('formatHeaderLines', () => {
  it('round-trips with parseHeaderLines', () => {
    const headers = { 'Content-Type': 'application/json', Accept: '*/*' };
    expect(parseHeaderLines(formatHeaderLines(headers))).toEqual(headers);
  });
});

describe('splitAuthHeader', () => {
  it('separates a case-insensitive authorization header from the rest', () => {
    const { authorization, rest } = splitAuthHeader({
      'content-type': 'application/json',
      Authorization: 'Bearer abc',
    });
    expect(authorization).toBe('Bearer abc');
    expect(rest).toEqual({ 'content-type': 'application/json' });
  });

  it('returns empty authorization when none is present (the capture default)', () => {
    const { authorization, rest } = splitAuthHeader({ 'content-type': 'application/json' });
    expect(authorization).toBe('');
    expect(rest).toEqual({ 'content-type': 'application/json' });
  });
});

describe('composeReplayHeaders', () => {
  it('adds the dedicated Authorization field to the outgoing headers', () => {
    const headers = composeReplayHeaders('Content-Type: application/json', 'Bearer s3cret');
    expect(headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer s3cret',
    });
  });

  it('omits Authorization entirely when the field is blank (no auth needed)', () => {
    const headers = composeReplayHeaders('Accept: */*', '   ');
    expect(headers).toEqual({ Accept: '*/*' });
    expect(headers.Authorization).toBeUndefined();
  });

  it('lets the dedicated field win over an authorization line in the textarea', () => {
    const headers = composeReplayHeaders('authorization: Bearer stale', 'Bearer fresh');
    expect(headers).toEqual({ Authorization: 'Bearer fresh' });
  });
});
