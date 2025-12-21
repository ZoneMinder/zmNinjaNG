import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import States from '../States';

const invalidateQueries = vi.fn();
const mutate = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: [
      { Id: '1', Name: 'Active', Definition: 'Active mode', IsActive: '1' },
      { Id: '2', Name: 'Idle', Definition: 'Idle mode', IsActive: '0' },
    ],
    isLoading: false,
    error: null,
  }),
  useMutation: () => ({
    mutate,
    isPending: false,
  }),
  useQueryClient: () => ({
    invalidateQueries,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../../lib/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    api: vi.fn(),
    auth: vi.fn(),
    profile: vi.fn(),
  },
}));

describe('States Page', () => {
  it('renders state cards and disables active state', () => {
    render(<States />);

    expect(screen.getByText('states.title')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Idle')).toBeInTheDocument();

    const activeButton = screen.getByRole('button', { name: 'states.active' });
    expect(activeButton).toBeDisabled();
  });

  it('triggers state change for inactive state', () => {
    render(<States />);

    const activateButton = screen.getByRole('button', { name: 'states.activate' });
    fireEvent.click(activateButton);

    expect(mutate).toHaveBeenCalledWith('Idle');
  });
});
