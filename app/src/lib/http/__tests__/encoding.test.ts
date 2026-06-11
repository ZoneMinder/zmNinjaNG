/**
 * Unit tests for the HTTP encoding helpers shared by the platform adapters.
 */

import { describe, it, expect } from 'vitest';
import {
  serializeRequestBody,
  normalizeHeaders,
  stringifyParams,
  bytesToBase64,
  base64ToBytes,
} from '../encoding';

describe('serializeRequestBody', () => {
  it('returns undefined for empty bodies', () => {
    expect(serializeRequestBody(undefined)).toBeUndefined();
    expect(serializeRequestBody(null)).toBeUndefined();
    expect(serializeRequestBody('')).toBeUndefined();
  });

  it('passes strings through unchanged', () => {
    expect(serializeRequestBody('raw=1&x=2')).toBe('raw=1&x=2');
  });

  it('serializes URLSearchParams to a query string', () => {
    const params = new URLSearchParams({ user: 'admin', pass: 'p w' });
    expect(serializeRequestBody(params)).toBe('user=admin&pass=p+w');
  });

  it('JSON-stringifies objects', () => {
    expect(serializeRequestBody({ a: 1, b: 'two' })).toBe('{"a":1,"b":"two"}');
  });
});

describe('normalizeHeaders', () => {
  it('converts a Headers instance to a plain record', () => {
    const headers = new Headers({ 'Content-Type': 'application/json', 'X-Foo': 'bar' });
    expect(normalizeHeaders(headers)).toEqual({
      'content-type': 'application/json',
      'x-foo': 'bar',
    });
  });

  it('returns an empty record for empty headers', () => {
    expect(normalizeHeaders(new Headers())).toEqual({});
  });
});

describe('stringifyParams', () => {
  it('converts number values to strings', () => {
    expect(stringifyParams({ id: 42, name: 'cam' })).toEqual({ id: '42', name: 'cam' });
  });

  it('returns an empty record for empty params', () => {
    expect(stringifyParams({})).toEqual({});
  });
});

describe('bytesToBase64 / base64ToBytes', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255, 66]);
    const base64 = bytesToBase64(bytes);
    expect(base64).toBe(btoa(String.fromCharCode(...bytes)));
    expect(Array.from(base64ToBytes(base64))).toEqual(Array.from(bytes));
  });

  it('handles empty input', () => {
    expect(bytesToBase64(new Uint8Array())).toBe('');
    expect(Array.from(base64ToBytes(''))).toEqual([]);
  });
});
