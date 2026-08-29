import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBanner } from '../query-state';

describe('ErrorBanner', () => {
  it('announces the failure to a screen reader', () => {
    // Every query failure in the app routes through this component (Query UI
    // states contract). Without a live region a sighted user sees red and a
    // screen-reader user is told nothing until they happen to tab into it.
    render(<ErrorBanner message="Server unreachable" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Server unreachable');
  });
});
