import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { ProfilePicker } from '../profile-picker';
import { asProfileId } from '../../api/types';
import type { Profile } from '../../api/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

// Radix's Select relies on portals/pointer APIs jsdom doesn't fully support.
const SelectContext = createContext<{ onValueChange?: (value: string) => void }>({});
vi.mock('../ui/select', () => ({
  Select: ({ children, onValueChange }: { children: ReactNode; onValueChange?: (value: string) => void }) => (
    <SelectContext.Provider value={{ onValueChange }}>{children}</SelectContext.Provider>
  ),
  SelectTrigger: ({ children, ...props }: { children: ReactNode }) => (
    <button type="button" {...props}>{children}</button>
  ),
  SelectValue: ({ placeholder }: { placeholder: string }) => <span>{placeholder}</span>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value, ...props }: { children: ReactNode; value: string }) => {
    const ctx = useContext(SelectContext);
    return (
      <button type="button" {...props} onClick={() => ctx.onValueChange?.(value)}>
        {children}
      </button>
    );
  },
}));

const profileA = { id: asProfileId('profile-a'), name: 'Home' } as Profile;
const profileB = { id: asProfileId('profile-b'), name: 'Work' } as Profile;

describe('ProfilePicker', () => {
  it('lists every profile in scope and reports the pick', () => {
    const onChange = vi.fn();
    render(<ProfilePicker profiles={[profileA, profileB]} value={profileA.id} onChange={onChange} />);

    expect(screen.getByTestId('page-profile-picker')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('page-profile-picker-option-profile-b'));
    expect(onChange).toHaveBeenCalledWith('profile-b');
  });
});
