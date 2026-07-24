import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { EventFrameCarousel } from '../EventFrameCarousel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const baseProps = {
  portalUrl: 'https://zm.example.com',
  eventId: '4242',
  token: 'tok',
  hasAlarmFrame: true,
};

function renderCarousel(props: Partial<React.ComponentProps<typeof EventFrameCarousel>> = {}) {
  return render(<EventFrameCarousel {...baseProps} {...props} />);
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('EventFrameCarousel', () => {
  it('shows a thumbnail per candidate frame with the event image URL', () => {
    renderCarousel();

    expect(screen.getByTestId('event-frame-thumb-alarm')).toBeTruthy();
    expect(screen.getByTestId('event-frame-thumb-snapshot')).toBeTruthy();
    // The dev image proxy percent-encodes the ZoneMinder URL into a query
    // parameter, so assert against the decoded form.
    const objdetect = decodeURIComponent(
      screen.getByTestId('event-frame-thumb-objdetect').querySelector('img')!.getAttribute('src')!
    );
    expect(objdetect).toContain('fid=objdetect');
    expect(objdetect).toContain('eid=4242');
  });

  it('skips the alarm frame when the event has none', () => {
    renderCarousel({ hasAlarmFrame: false });

    expect(screen.queryByTestId('event-frame-thumb-alarm')).toBeNull();
    expect(screen.getByTestId('event-frame-thumb-snapshot')).toBeTruthy();
  });

  it('drops a frame whose image fails to load', () => {
    renderCarousel();

    const objdetect = screen.getByTestId('event-frame-thumb-objdetect').querySelector('img')!;
    fireEvent.error(objdetect);

    expect(screen.queryByTestId('event-frame-thumb-objdetect')).toBeNull();
    expect(screen.getByTestId('event-frame-thumb-snapshot')).toBeTruthy();
  });

  it('renders nothing once every frame has failed', () => {
    renderCarousel();

    for (const type of ['alarm', 'snapshot', 'objdetect']) {
      fireEvent.error(screen.getByTestId(`event-frame-thumb-${type}`).querySelector('img')!);
    }

    expect(screen.queryByTestId('event-frames-card')).toBeNull();
  });

  it('reports the viewer opening and closing so playback can pause and resume', () => {
    const onViewerOpenChange = vi.fn();
    renderCarousel({ onViewerOpenChange });

    fireEvent.click(screen.getByTestId('event-frame-thumb-alarm'));
    expect(onViewerOpenChange).toHaveBeenLastCalledWith(true);

    const fullImage = decodeURIComponent(
      screen.getByTestId('event-frame-viewer-image').getAttribute('src')!
    );
    expect(fullImage).toContain('fid=alarm');
    expect(fullImage).not.toContain('width=');

    fireEvent.click(screen.getByTestId('dialog-close-button'));
    expect(onViewerOpenChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByTestId('event-frame-viewer-image')).toBeNull();
  });

  it('persists the collapsed state', () => {
    const { unmount } = renderCarousel();

    fireEvent.click(screen.getByText('event_detail.frames_title'));
    expect(screen.queryByTestId('event-frame-thumb-alarm')).toBeNull();

    unmount();
    renderCarousel();
    expect(screen.queryByTestId('event-frame-thumb-alarm')).toBeNull();
  });
});
