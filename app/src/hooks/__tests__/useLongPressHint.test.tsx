import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { UI_INTERACTIONS } from '../../lib/zmninja-ng-constants';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { dismiss: vi.fn() }),
}));

/** Press, hold past the long-press threshold, then release. */
function longPress(el: HTMLElement) {
  fireEvent.pointerDown(el, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 });
  act(() => {
    vi.advanceTimersByTime(UI_INTERACTIONS.longPressMs);
  });
  fireEvent.pointerUp(el, { pointerId: 1, pointerType: 'touch' });
}

describe('useLongPressHint via Button', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(toast).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the title as a toast after a long press on a touch screen', () => {
    render(<Button title="Save snapshot" data-testid="btn" />);

    longPress(screen.getByTestId('btn'));

    expect(vi.mocked(toast)).toHaveBeenCalledWith(
      'Save snapshot',
      expect.objectContaining({ duration: UI_INTERACTIONS.hintDurationMs }),
    );
  });

  it('stays quiet when the press is released before the threshold', () => {
    render(<Button title="Save snapshot" data-testid="btn" />);
    const btn = screen.getByTestId('btn');

    fireEvent.pointerDown(btn, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 });
    act(() => {
      vi.advanceTimersByTime(UI_INTERACTIONS.longPressMs - 50);
    });
    fireEvent.pointerUp(btn, { pointerId: 1, pointerType: 'touch' });

    expect(vi.mocked(toast)).not.toHaveBeenCalled();
  });

  it('cancels the hint when the finger drags away, so scrolls do not fire it', () => {
    render(<Button title="Save snapshot" data-testid="btn" />);
    const btn = screen.getByTestId('btn');

    fireEvent.pointerDown(btn, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 });
    fireEvent.pointerMove(btn, {
      pointerId: 1,
      clientX: 10,
      clientY: 10 + UI_INTERACTIONS.moveCancelPx + 5,
    });
    act(() => {
      vi.advanceTimersByTime(UI_INTERACTIONS.longPressMs);
    });

    expect(vi.mocked(toast)).not.toHaveBeenCalled();
  });

  it('swallows the click that follows a hint so the action does not run', () => {
    const onClick = vi.fn();
    render(<Button title="Save snapshot" onClick={onClick} data-testid="btn" />);
    const btn = screen.getByTestId('btn');

    longPress(btn);
    fireEvent.click(btn);

    expect(vi.mocked(toast)).toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('lets a normal tap through untouched', () => {
    const onClick = vi.fn();
    render(<Button title="Save snapshot" onClick={onClick} data-testid="btn" />);
    const btn = screen.getByTestId('btn');

    fireEvent.pointerDown(btn, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 });
    fireEvent.pointerUp(btn, { pointerId: 1, pointerType: 'touch' });
    fireEvent.click(btn);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast)).not.toHaveBeenCalled();
  });

  it('leaves hold-to-repeat buttons alone, since they own the press gesture', () => {
    const onPointerDown = vi.fn();
    render(<Button title="Zoom in" onPointerDown={onPointerDown} data-testid="btn" />);

    longPress(screen.getByTestId('btn'));

    expect(onPointerDown).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast)).not.toHaveBeenCalled();
  });

  it('stays quiet on a mouse, where hover already shows the title', () => {
    render(<Button title="Save snapshot" data-testid="btn" />);

    fireEvent.pointerDown(screen.getByTestId('btn'), {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 10,
      clientY: 10,
    });
    act(() => {
      vi.advanceTimersByTime(UI_INTERACTIONS.longPressMs);
    });

    expect(vi.mocked(toast)).not.toHaveBeenCalled();
  });

  it('stays quiet when the button has no title to explain', () => {
    render(<Button data-testid="btn" />);

    longPress(screen.getByTestId('btn'));

    expect(vi.mocked(toast)).not.toHaveBeenCalled();
  });
});
