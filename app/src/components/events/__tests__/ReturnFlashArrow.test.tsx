import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReturnFlashArrow } from '../ReturnFlashArrow';

describe('ReturnFlashArrow', () => {
  it('renders an aria-hidden, motion-safe blinking indicator', () => {
    render(<ReturnFlashArrow />);
    const el = screen.getByTestId('return-flash-indicator');
    expect(el).toBeTruthy();
    expect(el.getAttribute('aria-hidden')).toBe('true');
    // SVG elements use getAttribute for class access (className is SVGAnimatedString)
    expect(el.getAttribute('class')).toContain('motion-safe:animate-blink');
  });
});
