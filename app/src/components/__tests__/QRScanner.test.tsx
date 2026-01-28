/**
 * Tests for QRScanner component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QRScanner } from '../QRScanner';

// Mock Capacitor
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true, // Test native platform behavior
  },
}));

// Mock capacitor-barcode-scanner
const mockScan = vi.fn();
vi.mock('capacitor-barcode-scanner', () => ({
  BarcodeScanner: {
    scan: mockScan,
  },
}));

// Mock logger
vi.mock('../../lib/logger', () => ({
  log: {
    profile: vi.fn(),
  },
  LogLevel: {
    INFO: 'info',
    ERROR: 'error',
    WARN: 'warn',
    DEBUG: 'debug',
  },
}));

// Mock translations
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('QRScanner', () => {
  const mockOnScan = vi.fn();
  const mockOnOpenChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render when open', () => {
    render(
      <QRScanner
        open={true}
        onOpenChange={mockOnOpenChange}
        onScan={mockOnScan}
      />
    );

    expect(screen.getByTestId('qr-scanner-dialog')).toBeInTheDocument();
    expect(screen.getByText('qr_scanner.title')).toBeInTheDocument();
  });

  it('should not render when closed', () => {
    render(
      <QRScanner
        open={false}
        onOpenChange={mockOnOpenChange}
        onScan={mockOnScan}
      />
    );

    expect(screen.queryByTestId('qr-scanner-dialog')).not.toBeInTheDocument();
  });

  it('should show scan with camera button on native platforms', () => {
    render(
      <QRScanner
        open={true}
        onOpenChange={mockOnOpenChange}
        onScan={mockOnScan}
      />
    );

    expect(screen.getByTestId('qr-scanner-camera')).toBeInTheDocument();
  });

  it('should reset state when dialog reopens after closing', async () => {
    const user = userEvent.setup();

    const { rerender } = render(
      <QRScanner
        open={true}
        onOpenChange={mockOnOpenChange}
        onScan={mockOnScan}
      />
    );

    // Simulate user cancelling the native scanner
    mockScan.mockResolvedValueOnce({ result: false });

    // Click scan button
    const scanButton = screen.getByTestId('qr-scanner-camera');
    await user.click(scanButton);

    // Wait for scan to complete (cancelled)
    await waitFor(() => {
      expect(mockScan).toHaveBeenCalled();
    });

    // Close dialog
    const cancelButton = screen.getByTestId('qr-scanner-cancel');
    await user.click(cancelButton);

    expect(mockOnOpenChange).toHaveBeenCalledWith(false);

    // Reopen dialog
    rerender(
      <QRScanner
        open={false}
        onOpenChange={mockOnOpenChange}
        onScan={mockOnScan}
      />
    );

    rerender(
      <QRScanner
        open={true}
        onOpenChange={mockOnOpenChange}
        onScan={mockOnScan}
      />
    );

    // Verify dialog is rendered again with reset state
    await waitFor(() => {
      expect(screen.getByTestId('qr-scanner-dialog')).toBeInTheDocument();
    });

    // Verify scan button is enabled and clickable
    const scanButtonAfterReopen = screen.getByTestId('qr-scanner-camera');
    expect(scanButtonAfterReopen).toBeEnabled();

    // Should be able to scan again
    mockScan.mockResolvedValueOnce({ result: false });
    await user.click(scanButtonAfterReopen);

    await waitFor(() => {
      expect(mockScan).toHaveBeenCalledTimes(2);
    });
  });

  it('should reset isStarting and isProcessingFile state when closing dialog', async () => {
    const user = userEvent.setup();

    const { rerender } = render(
      <QRScanner
        open={true}
        onOpenChange={mockOnOpenChange}
        onScan={mockOnScan}
      />
    );

    // Close dialog
    const cancelButton = screen.getByTestId('qr-scanner-cancel');
    await user.click(cancelButton);

    expect(mockOnOpenChange).toHaveBeenCalledWith(false);

    // Reopen dialog - state should be reset
    rerender(
      <QRScanner
        open={true}
        onOpenChange={mockOnOpenChange}
        onScan={mockOnScan}
      />
    );

    // Verify all buttons are enabled (not stuck in starting/processing state)
    const scanButton = screen.getByTestId('qr-scanner-camera');
    const loadFileButton = screen.getByTestId('qr-scanner-load-file');

    expect(scanButton).toBeEnabled();
    expect(loadFileButton).toBeEnabled();
  });

  it('should handle successful scan', async () => {
    const user = userEvent.setup();
    const scannedCode = 'https://example.com/qr-profile';

    mockScan.mockResolvedValueOnce({
      result: true,
      code: scannedCode,
    });

    render(
      <QRScanner
        open={true}
        onOpenChange={mockOnOpenChange}
        onScan={mockOnScan}
      />
    );

    const scanButton = screen.getByTestId('qr-scanner-camera');
    await user.click(scanButton);

    await waitFor(() => {
      expect(mockOnScan).toHaveBeenCalledWith(scannedCode);
      expect(mockOnOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('should allow file upload', () => {
    render(
      <QRScanner
        open={true}
        onOpenChange={mockOnOpenChange}
        onScan={mockOnScan}
      />
    );

    expect(screen.getByTestId('qr-scanner-load-file')).toBeInTheDocument();
    expect(screen.getByTestId('qr-scanner-file-input')).toBeInTheDocument();
  });
});
