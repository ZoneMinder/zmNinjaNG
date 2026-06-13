import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Markdown } from '../markdown';

describe('Markdown link rendering', () => {
  it('renders a safe https link as an anchor', () => {
    const { container } = render(<Markdown source="[open](https://example.com)" />);
    const anchor = container.querySelector('a');
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute('href')).toBe('https://example.com');
  });

  it('does not create an anchor for a javascript: link, keeps the label text', () => {
    const { container } = render(<Markdown source="[click me](javascript:alert(1))" />);
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('click me');
    expect(container.innerHTML).not.toContain('javascript:');
  });
});
