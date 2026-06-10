import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from '../badge';

describe('Badge status variants', () => {
  it('renders the info variant with blue status classes', () => {
    render(<Badge variant="info" data-testid="badge">3</Badge>);
    const badge = screen.getByTestId('badge');
    expect(badge.className).toContain('bg-blue-500/15');
    expect(badge.className).toContain('text-blue-400');
    expect(badge.className).toContain('border-blue-500/20');
  });

  it('renders the success variant with theme-aware green classes', () => {
    render(<Badge variant="success" data-testid="badge">on</Badge>);
    const badge = screen.getByTestId('badge');
    expect(badge.className).toContain('bg-green-100');
    expect(badge.className).toContain('text-green-700');
    expect(badge.className).toContain('dark:bg-green-900');
    expect(badge.className).toContain('dark:text-green-300');
  });

  it('keeps caller classes alongside the variant classes', () => {
    render(<Badge variant="info" className="text-xs" data-testid="badge">7</Badge>);
    const badge = screen.getByTestId('badge');
    expect(badge.className).toContain('text-xs');
    expect(badge.className).toContain('bg-blue-500/15');
  });
});
