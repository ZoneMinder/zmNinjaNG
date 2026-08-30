/**
 * Regression guard: a re-render of the screen around the menu must not close
 * it. The menu owns its open state (see view-options.tsx), so this holds by
 * construction; the test exists so that moving the state back into Radix's
 * internal, or wrapping the menu in something that remounts it, is caught.
 *
 * Note for the honest record: this test also passes against the version
 * that let Radix own the state, because a parent re-render never resets a
 * child's useState. The e2e flake that motivated the change had another
 * cause; the change is kept because controlled state cannot be lost, not
 * because this test showed it being lost.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ViewOptionsMenu, FeedFitItems } from '../view-options';

let rerenderParent: () => void = () => {};

function Screen() {
  const [tick, setTick] = useState(0);
  rerenderParent = () => setTick((t) => t + 1);
  return (
    <div data-tick={tick}>
      <ViewOptionsMenu testId="montage">
        <FeedFitItems value="cover" onChange={() => {}} testIdPrefix="montage" />
      </ViewOptionsMenu>
    </div>
  );
}

describe('ViewOptionsMenu', () => {
  it('stays open while the screen around it re-renders', async () => {
    const user = userEvent.setup();
    render(<Screen />);

    const trigger = screen.getByTestId('montage-menu');
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('montage-fit-cover')).toHaveAttribute('aria-checked', 'true');

    for (let i = 0; i < 3; i++) act(() => rerenderParent());

    expect(screen.getByTestId('montage-fit-cover')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('montage-fit-contain')).toHaveAttribute('aria-checked', 'false');
  });
});
