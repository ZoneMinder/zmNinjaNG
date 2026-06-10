/**
 * Tests for useTimelineGestures brush overlay clear timer cleanup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useTimelineGestures, type GestureCallbacks } from '../useTimelineGestures';

function Harness({ callbacks }: { callbacks: GestureCallbacks }) {
  const ref = useTimelineGestures(callbacks);
  return <canvas ref={ref} data-testid="gesture-canvas" />;
}

function makeCallbacks(overrides: Partial<GestureCallbacks> = {}): GestureCallbacks {
  return {
    onPan: vi.fn(),
    onZoom: vi.fn(),
    onHover: vi.fn(),
    onHoverEnd: vi.fn(),
    onClick: vi.fn(),
    brushMode: true,
    onBrushZoom: vi.fn(),
    onBrushUpdate: vi.fn(),
    ...overrides,
  };
}

describe('useTimelineGestures brush clear timer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears the brush overlay 50ms after a brush release', () => {
    const onBrushUpdate = vi.fn();
    const callbacks = makeCallbacks({ onBrushUpdate });
    render(<Harness callbacks={callbacks} />);
    const canvas = screen.getByTestId('gesture-canvas');

    fireEvent.mouseDown(canvas, { button: 0, clientX: 10, clientY: 5 });
    fireEvent.mouseUp(canvas, { clientX: 50, clientY: 5 });
    onBrushUpdate.mockClear();

    vi.advanceTimersByTime(50);
    expect(onBrushUpdate).toHaveBeenCalledWith(0, 0);
  });

  it('does not fire the brush clear callback after unmount', () => {
    const onBrushUpdate = vi.fn();
    const callbacks = makeCallbacks({ onBrushUpdate });
    const { unmount } = render(<Harness callbacks={callbacks} />);
    const canvas = screen.getByTestId('gesture-canvas');

    fireEvent.mouseDown(canvas, { button: 0, clientX: 10, clientY: 5 });
    fireEvent.mouseUp(canvas, { clientX: 50, clientY: 5 });
    onBrushUpdate.mockClear();
    unmount();

    vi.advanceTimersByTime(100);
    expect(onBrushUpdate).not.toHaveBeenCalled();
  });

  it('does not fire the brush clear callback after a touch brush release and unmount', () => {
    const onBrushUpdate = vi.fn();
    const callbacks = makeCallbacks({ onBrushUpdate });
    const { unmount } = render(<Harness callbacks={callbacks} />);
    const canvas = screen.getByTestId('gesture-canvas');

    fireEvent.touchStart(canvas, { touches: [{ clientX: 10, clientY: 5 }] });
    fireEvent.touchEnd(canvas, {
      touches: [],
      changedTouches: [{ clientX: 50, clientY: 5 }],
    });
    onBrushUpdate.mockClear();
    unmount();

    vi.advanceTimersByTime(100);
    expect(onBrushUpdate).not.toHaveBeenCalled();
  });
});
