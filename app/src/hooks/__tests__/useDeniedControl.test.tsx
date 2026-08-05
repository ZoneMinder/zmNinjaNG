/**
 * The props that turn a control into a refusal that explains itself.
 *
 * The key constraint is that a greyed control must still be reachable: a
 * `disabled` button dispatches no pointer events, so the long-press hint never
 * fires and browsers suppress `title` too - it would grey out and explain
 * nothing, which is the failure this whole change exists to fix.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { toast } from 'sonner';
import { useDeniedControl } from '../useDeniedControl';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

function Probe({ denied, onClick }: { denied: boolean; onClick: () => void }) {
  const props = useDeniedControl({
    denied,
    message: 'needs Events: Edit',
    onClick,
    title: 'Archive',
    className: 'p-1',
  });
  return <button data-testid="control" {...props}>Archive</button>;
}

describe('useDeniedControl', () => {
  beforeEach(() => vi.clearAllMocks());

  it('leaves an allowed control completely alone', () => {
    const onClick = vi.fn();
    render(<Probe denied={false} onClick={onClick} />);

    const button = screen.getByTestId('control');
    expect(button).not.toHaveAttribute('aria-disabled');
    expect(button).toHaveAttribute('title', 'Archive');

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('marks a refused control aria-disabled rather than disabled', () => {
    render(<Probe denied onClick={vi.fn()} />);

    const button = screen.getByTestId('control');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    // Still in the tab order and still receiving events, so a screen reader
    // announces it and the hint can fire.
    expect(button).not.toBeDisabled();
  });

  it('explains instead of acting when clicked', () => {
    const onClick = vi.fn();
    render(<Probe denied onClick={onClick} />);

    fireEvent.click(screen.getByTestId('control'));

    expect(onClick).not.toHaveBeenCalled();
    expect(vi.mocked(toast)).toHaveBeenCalledWith('needs Events: Edit');
  });

  it('carries the reason in title, which is what hover and long-press show', () => {
    render(<Probe denied onClick={vi.fn()} />);

    expect(screen.getByTestId('control')).toHaveAttribute('title', 'needs Events: Edit');
  });

  it('keeps the caller classes and adds the muted treatment', () => {
    render(<Probe denied onClick={vi.fn()} />);

    const className = screen.getByTestId('control').className;
    expect(className).toContain('p-1');
    expect(className).toContain('opacity-50');
  });
});
