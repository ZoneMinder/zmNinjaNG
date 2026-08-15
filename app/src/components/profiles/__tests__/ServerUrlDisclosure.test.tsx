import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ServerUrlDisclosure } from '../ServerUrlDisclosure';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const rows = [
  { label: 'Portal', url: 'https://zm.example.com/zm' },
  { label: 'API', url: 'https://zm.example.com/zm/api' },
];

describe('ServerUrlDisclosure', () => {
  it('keeps the addresses out of the way until asked', () => {
    render(<ServerUrlDisclosure rows={rows} testId="profile-urls-p1" />);

    expect(screen.queryByText('https://zm.example.com/zm')).not.toBeInTheDocument();
    expect(screen.getByTestId('profile-urls-p1-toggle')).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows every address once opened, and hides them again', async () => {
    render(<ServerUrlDisclosure rows={rows} testId="profile-urls-p1" />);
    const toggle = screen.getByTestId('profile-urls-p1-toggle');

    await userEvent.click(toggle);
    expect(screen.getByText('https://zm.example.com/zm')).toBeInTheDocument();
    expect(screen.getByText('https://zm.example.com/zm/api')).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(toggle);
    expect(screen.queryByText('https://zm.example.com/zm')).not.toBeInTheDocument();
  });

  it('does not reach a card that treats a click as a selection', async () => {
    // Listen on the ancestor rather than wrapping in a clickable div: the
    // question is whether the click bubbles, and a fake clickable div would
    // itself fail the accessibility lint this project blocks on.
    render(<ServerUrlDisclosure rows={rows} testId="profile-urls-p1" />);
    const bubbled = vi.fn();
    // Above React's own root listener, so this only fires if the click was
    // allowed to carry on past the component - which is what a card wrapping
    // it would see.
    document.body.addEventListener('click', bubbled);

    await userEvent.click(screen.getByTestId('profile-urls-p1-toggle'));
    document.body.removeEventListener('click', bubbled);
    expect(bubbled).not.toHaveBeenCalled();
  });

  it('renders nothing at all when there is no address to show', () => {
    render(<ServerUrlDisclosure rows={[]} testId="profile-urls-empty" />);
    expect(screen.queryByTestId('profile-urls-empty-toggle')).not.toBeInTheDocument();
  });
});
