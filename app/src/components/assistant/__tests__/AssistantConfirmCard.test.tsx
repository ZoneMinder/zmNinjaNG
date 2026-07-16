import { render, screen, fireEvent } from '@testing-library/react';
import { it, expect, vi } from 'vitest';
import { AssistantConfirmCard } from '../AssistantConfirmCard';

it('confirms and cancels a destructive action', () => {
  const onAccept = vi.fn(); const onCancel = vi.fn();
  render(<AssistantConfirmCard request={{ toolName: 'set_monitor_enabled', messageKey: 'assistant.confirm.set_monitor_enabled', messageParams: { id: '4', enabled: false }, params: { monitorId: '4' } }} onAccept={onAccept} onCancel={onCancel} />);
  fireEvent.click(screen.getByTestId('assistant-confirm-cancel'));
  expect(onCancel).toHaveBeenCalled();
  fireEvent.click(screen.getByTestId('assistant-confirm-accept'));
  expect(onAccept).toHaveBeenCalled();
});
