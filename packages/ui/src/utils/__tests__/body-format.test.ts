import { describe, it, expect } from 'vitest';
import { formatBody, buildResponseSection, stripResponseAttributes } from '../body-format.js';

describe('stripResponseAttributes', () => {
  it('removes http.response.* keys so they do not render twice alongside ResponseSection', () => {
    const filtered = stripResponseAttributes({
      'http.method': 'GET',
      'http.route': '/api/users',
      'http.response.status': 200,
      'http.response.body': '{"big":"payload"}',
      'http.response.header.content-type': 'application/json',
      'http.response.header.set-cookie': 'sid=x',
    });
    expect(filtered).toEqual({
      'http.method': 'GET',
      'http.route': '/api/users',
    });
  });

  it('leaves http.request.* attributes untouched', () => {
    const attrs = {
      'http.request.body': '{"q":1}',
      'http.request.header.content-type': 'application/json',
      'http.method': 'POST',
    };
    expect(stripResponseAttributes(attrs)).toEqual(attrs);
  });
});

describe('formatBody', () => {
  it('pretty-prints JSON bodies', () => {
    expect(formatBody('{"a":1,"b":[2,3]}', 'application/json')).toBe(
      '{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}'
    );
  });

  it('returns raw text for non-JSON content types', () => {
    expect(formatBody('hello world', 'text/plain')).toBe('hello world');
  });

  it('returns the raw body when JSON parsing fails', () => {
    expect(formatBody('not json {', 'application/json')).toBe('not json {');
  });
});

describe('buildResponseSection', () => {
  it('returns null when the span has no response attributes', () => {
    expect(buildResponseSection({ 'http.method': 'GET' })).toBeNull();
  });

  it('extracts status, headers, and body from span attributes', () => {
    const section = buildResponseSection({
      'http.method': 'POST',
      'http.response.status': 201,
      'http.response.header.content-type': 'application/json; charset=utf-8',
      'http.response.header.x-custom': 'hi',
      'http.response.body': '{"ok":true}',
    });

    expect(section).not.toBeNull();
    expect(section!.status).toBe(201);
    expect(section!.body).toBe('{"ok":true}');
    expect(section!.headers['content-type']).toContain('application/json');
    expect(section!.headers['x-custom']).toBe('hi');
    expect(section!.contentType).toContain('application/json');
  });

  it('coerces a string status to a number', () => {
    const section = buildResponseSection({ 'http.response.status': '404' });
    expect(section!.status).toBe(404);
  });

  it('handles a response with headers/status but no body (e.g. 204)', () => {
    const section = buildResponseSection({
      'http.response.status': 204,
      'http.response.header.content-length': '0',
    });
    expect(section!.status).toBe(204);
    expect(section!.body).toBeUndefined();
  });

  it('passes the binary summary placeholder through as the body', () => {
    const section = buildResponseSection({
      'http.response.status': 200,
      'http.response.header.content-type': 'image/png',
      'http.response.body': '[binary image/png response, 1024 bytes — not captured]',
    });
    expect(section!.body).toContain('binary');
    expect(formatBody(section!.body!, section!.contentType)).toContain('binary');
  });
});
