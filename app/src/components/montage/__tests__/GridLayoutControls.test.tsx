/**
 * Tests for GridLayoutControls (montage wrapper around GridColumnsMenu).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GridLayoutControls } from '../GridLayoutControls';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}));

const savedLayout = { name: 'My layout', layout: [], displayCols: 3 };

const baseProps = {
  isMobile: false,
  gridCols: 2,
  activeLayoutName: null,
  onApplyGridLayout: vi.fn(),
  savedLayouts: [],
  onSaveLayout: vi.fn(),
  onLoadLayout: vi.fn(),
  onDeleteLayout: vi.fn(),
};

describe('GridLayoutControls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the layout trigger with grid-cols attribute', () => {
    render(<GridLayoutControls {...baseProps} />);
    const trigger = screen.getByTestId('montage-layout-trigger');
    expect(trigger).toHaveAttribute('data-grid-cols', '2');
  });

  it('renders all five preset testids and applies a preset on click', async () => {
    const user = userEvent.setup();
    render(<GridLayoutControls {...baseProps} />);
    await user.click(screen.getByTestId('montage-layout-trigger'));
    for (const cols of [1, 2, 3, 4, 5]) {
      expect(screen.getByTestId(`montage-grid-preset-${cols}`)).toBeInTheDocument();
    }
    await user.click(screen.getByTestId('montage-grid-preset-4'));
    expect(baseProps.onApplyGridLayout).toHaveBeenCalledWith(4);
  });

  it('rejects an out-of-range custom column count', async () => {
    const user = userEvent.setup();
    render(<GridLayoutControls {...baseProps} />);
    await user.click(screen.getByTestId('montage-layout-trigger'));
    await user.click(screen.getByText('montage.custom'));
    fireEvent.change(screen.getByLabelText('montage.columns_label'), {
      target: { value: '12' },
    });
    await user.click(screen.getByText('montage.apply'));
    expect(toastError).toHaveBeenCalledWith('montage.invalid_columns');
    expect(baseProps.onApplyGridLayout).not.toHaveBeenCalled();
  });

  it('applies a valid custom column count and closes the dialog', async () => {
    const user = userEvent.setup();
    render(<GridLayoutControls {...baseProps} />);
    await user.click(screen.getByTestId('montage-layout-trigger'));
    await user.click(screen.getByText('montage.custom'));
    fireEvent.change(screen.getByLabelText('montage.columns_label'), {
      target: { value: '7' },
    });
    await user.click(screen.getByText('montage.apply'));
    expect(baseProps.onApplyGridLayout).toHaveBeenCalledWith(7);
    expect(screen.queryByText('montage.custom_grid_title')).not.toBeInTheDocument();
  });

  it('shows the saved layouts section only when layouts exist', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<GridLayoutControls {...baseProps} />);
    await user.click(screen.getByTestId('montage-layout-trigger'));
    expect(screen.queryByText('montage.saved_layouts')).not.toBeInTheDocument();
    unmount();

    render(<GridLayoutControls {...baseProps} savedLayouts={[savedLayout]} />);
    await user.click(screen.getByTestId('montage-layout-trigger'));
    expect(screen.getByText('montage.saved_layouts')).toBeInTheDocument();
    expect(screen.getByText('My layout')).toBeInTheDocument();
  });

  it('loads a saved layout on click', async () => {
    const user = userEvent.setup();
    render(<GridLayoutControls {...baseProps} savedLayouts={[savedLayout]} />);
    await user.click(screen.getByTestId('montage-layout-trigger'));
    await user.click(screen.getByText('My layout'));
    expect(baseProps.onLoadLayout).toHaveBeenCalledWith(savedLayout);
  });

  it('requires a name when saving a layout', async () => {
    const user = userEvent.setup();
    render(<GridLayoutControls {...baseProps} />);
    await user.click(screen.getByTestId('montage-layout-trigger'));
    await user.click(screen.getByText('montage.save_layout'));
    await user.click(screen.getByText('common.save'));
    expect(toastError).toHaveBeenCalledWith('montage.save_name_required');
    expect(baseProps.onSaveLayout).not.toHaveBeenCalled();
  });

  it('saves a layout with a trimmed name', async () => {
    const user = userEvent.setup();
    render(<GridLayoutControls {...baseProps} />);
    await user.click(screen.getByTestId('montage-layout-trigger'));
    await user.click(screen.getByText('montage.save_layout'));
    fireEvent.change(screen.getByLabelText('montage.layout_name'), {
      target: { value: '  Garage view  ' },
    });
    await user.click(screen.getByText('common.save'));
    expect(baseProps.onSaveLayout).toHaveBeenCalledWith('Garage view');
  });

  it('renders the mobile sheet with preset testids', async () => {
    const user = userEvent.setup();
    render(<GridLayoutControls {...baseProps} isMobile />);
    await user.click(screen.getByTestId('montage-layout-trigger'));
    expect(await screen.findByTestId('montage-grid-preset-1')).toBeInTheDocument();
    expect(screen.getByTestId('montage-grid-preset-5')).toBeInTheDocument();
  });
});
