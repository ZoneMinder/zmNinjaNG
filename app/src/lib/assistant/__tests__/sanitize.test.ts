import { describe, it, expect } from 'vitest';
import { decodeByteFallbackTokens, sanitizeModelText } from '../sanitize';

describe('decodeByteFallbackTokens', () => {
  it('decodes the narrow no-break space gemma4 leaked into answers', () => {
    // The exact shape seen in a live transcript: "08:20<0xE2><0x80><0xAF>AM".
    expect(decodeByteFallbackTokens('08:20<0xE2><0x80><0xAF>AM')).toBe('08:20 AM');
  });

  it('decodes a two-byte no-break space', () => {
    expect(decodeByteFallbackTokens('30<0xC2><0xA0>seconds')).toBe('30 seconds');
  });

  it('decodes several runs in one string', () => {
    expect(decodeByteFallbackTokens('a<0xC2><0xA0>b<0xE2><0x80><0xAF>c')).toBe('a b c');
  });

  it('joins nothing: the decoded character keeps the words apart', () => {
    // Stripping instead of decoding would produce "08:20AM", turning a visible
    // defect into a silent one.
    const decoded = decodeByteFallbackTokens('08:20<0xE2><0x80><0xAF>AM');
    expect(decoded).not.toBe('08:20AM');
    expect(decoded).toHaveLength('08:20 AM'.length);
  });

  it('leaves text without byte tokens untouched', () => {
    const clean = 'Today’s activity: 1 event on Garage Outdoor.';
    expect(decodeByteFallbackTokens(clean)).toBe(clean);
  });

  it('leaves an invalid byte run exactly as it was rather than writing U+FFFD', () => {
    // 0xFF is not valid UTF-8 in any position. Mangling it further would
    // destroy the evidence of whatever produced it.
    expect(decodeByteFallbackTokens('x<0xFF>y')).toBe('x<0xFF>y');
  });

  it('is case insensitive about the hex digits', () => {
    expect(decodeByteFallbackTokens('<0xc2><0xa0>')).toBe(' ');
  });
});

describe('sanitizeModelText', () => {
  it('returns the repaired text', () => {
    expect(sanitizeModelText('30<0xC2><0xA0>seconds', 'answer')).toBe('30 seconds');
  });

  it('passes clean text straight through', () => {
    expect(sanitizeModelText('no events found', 'answer')).toBe('no events found');
  });
});
