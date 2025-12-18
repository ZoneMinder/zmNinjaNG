/**
 * Unit tests for general utilities
 */

import { describe, it, expect } from 'vitest';
import { cn, escapeHtml, formatEventCount } from '../utils';

describe('cn (className merger)', () => {
  it('merges multiple class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('handles conditional classes', () => {
    expect(cn('foo', false && 'bar', 'baz')).toBe('foo baz');
  });

  it('handles objects with boolean values', () => {
    expect(cn({ foo: true, bar: false, baz: true })).toBe('foo baz');
  });

  it('resolves Tailwind conflicts', () => {
    // tailwind-merge should keep the last conflicting class
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });

  it('handles empty input', () => {
    expect(cn()).toBe('');
  });

  it('filters out undefined and null', () => {
    expect(cn('foo', undefined, 'bar', null, 'baz')).toBe('foo bar baz');
  });

  it('handles arrays of classes', () => {
    expect(cn(['foo', 'bar'], 'baz')).toBe('foo bar baz');
  });

  it('handles complex combinations', () => {
    expect(cn(
      'base-class',
      { active: true, disabled: false },
      ['foo', 'bar'],
      undefined,
      'final'
    )).toContain('base-class');
  });
});

describe('escapeHtml', () => {
  it('escapes ampersands', () => {
    expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
  });

  it('escapes less than signs', () => {
    expect(escapeHtml('5 < 10')).toBe('5 &lt; 10');
  });

  it('escapes greater than signs', () => {
    expect(escapeHtml('10 > 5')).toBe('10 &gt; 5');
  });

  it('escapes double quotes', () => {
    expect(escapeHtml('Say "hello"')).toBe('Say &quot;hello&quot;');
  });

  it('escapes single quotes', () => {
    expect(escapeHtml("It's working")).toBe('It&#39;s working');
  });

  it('escapes forward slashes', () => {
    expect(escapeHtml('path/to/file')).toBe('path&#x2F;to&#x2F;file');
  });

  it('escapes script tags', () => {
    expect(escapeHtml('<script>alert("XSS")</script>'))
      .toBe('&lt;script&gt;alert(&quot;XSS&quot;)&lt;&#x2F;script&gt;');
  });

  it('escapes img tags with onerror', () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">'))
      .toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('handles string with no special characters', () => {
    expect(escapeHtml('Hello World')).toBe('Hello World');
  });

  it('escapes multiple special characters in sequence', () => {
    expect(escapeHtml('<>&"\'/'))
      .toBe('&lt;&gt;&amp;&quot;&#39;&#x2F;');
  });

  it('preserves normal text around escaped characters', () => {
    expect(escapeHtml('Hello <world> & "universe"'))
      .toBe('Hello &lt;world&gt; &amp; &quot;universe&quot;');
  });

  it('handles XSS attempt with event handler', () => {
    const xss = 'Click <a href="#" onclick="alert(\'XSS\')">here</a>';
    const escaped = escapeHtml(xss);

    // Escapes HTML tags so they can't execute
    expect(escaped).not.toContain('<a');
    expect(escaped).toContain('&lt;a');

    // The word "onclick" is still there but surrounded by escaped quotes
    // so it can't execute as JavaScript
    expect(escaped).toContain('onclick=&quot;');
  });

  it('handles complex nested HTML', () => {
    const html = '<div><span>Text</span></div>';
    expect(escapeHtml(html))
      .toBe('&lt;div&gt;&lt;span&gt;Text&lt;&#x2F;span&gt;&lt;&#x2F;div&gt;');
  });

  it('escapes javascript: protocol', () => {
    expect(escapeHtml('javascript:alert(1)'))
      .toBe('javascript:alert(1)'); // JS protocol not escaped by this function
  });
});

describe('formatEventCount', () => {
  it('formats numbers under 1000 as-is', () => {
    expect(formatEventCount(0)).toBe('0');
    expect(formatEventCount(1)).toBe('1');
    expect(formatEventCount(42)).toBe('42');
    expect(formatEventCount(999)).toBe('999');
  });

  it('formats 1000+ as "k+"', () => {
    expect(formatEventCount(1000)).toBe('1k+');
    expect(formatEventCount(1500)).toBe('1k+');
    expect(formatEventCount(9999)).toBe('9k+');
    expect(formatEventCount(50000)).toBe('50k+');
    expect(formatEventCount(999999)).toBe('999k+');
  });

  it('formats 1000000+ as "M+"', () => {
    expect(formatEventCount(1000000)).toBe('1M+');
    expect(formatEventCount(1500000)).toBe('1M+');
    expect(formatEventCount(5000000)).toBe('5M+');
    expect(formatEventCount(999999999)).toBe('999M+');
  });

  it('handles undefined', () => {
    expect(formatEventCount(undefined)).toBe('0');
  });

  it('handles null', () => {
    expect(formatEventCount(null as any)).toBe('0');
  });

  it('floors numbers when dividing', () => {
    expect(formatEventCount(1999)).toBe('1k+');
    expect(formatEventCount(9999999)).toBe('9M+');
  });

  it('uses exact division for round numbers', () => {
    expect(formatEventCount(2000)).toBe('2k+');
    expect(formatEventCount(3000000)).toBe('3M+');
  });

  it('handles boundary values', () => {
    expect(formatEventCount(999)).toBe('999');
    expect(formatEventCount(1000)).toBe('1k+');
    expect(formatEventCount(999999)).toBe('999k+');
    expect(formatEventCount(1000000)).toBe('1M+');
  });

  it('handles very large numbers', () => {
    expect(formatEventCount(999999999999)).toBe('999999M+');
  });

  it('handles zero', () => {
    expect(formatEventCount(0)).toBe('0');
  });
});
