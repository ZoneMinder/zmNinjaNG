/**
 * `value` was destructured for the indicator's transform and never handed to
 * the Radix root, so the bar looked right and reported nothing: no
 * aria-valuenow, and a screen reader heard "progress bar" with no number.
 * Found when BackgroundTaskDrawer's tests moved from "the bar exists" to
 * asserting the value it shows (I3).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Progress } from '../progress';

describe('Progress', () => {
  it('exposes its value to assistive tech, not only to the eye', () => {
    render(<Progress value={40} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '40');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it('with no value it is indeterminate rather than reporting zero', () => {
    render(<Progress />);
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  });
});
