/**
 * The one place that shows the whole permission picture.
 *
 * Every other surface explains its own refusal in a sentence; this card is
 * where a user goes to find out why, including for the surfaces that vanish
 * entirely and have nowhere to put a note.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AccountPermissionsCard } from '../AccountPermissionsCard';
import { asProfileId } from '../../../api/types';
import { SYSTEM_NONE_PERMISSIONS } from '../../../lib/permissions/zm-permissions';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

let mockPermissions: unknown;
let mockLoading = false;
vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ permissions: mockPermissions, isLoading: mockLoading }),
}));

const profileId = asProfileId('p1');

describe('AccountPermissionsCard', () => {
  it('lists the level ZoneMinder reported for each column', () => {
    mockPermissions = {
      system: 'View',
      monitors: 'Edit',
      stream: 'None',
      events: 'View',
      control: 'None',
      groups: 'View',
    };

    render(<AccountPermissionsCard profileId={profileId} />);

    expect(screen.getByTestId('account-permission-system')).toHaveTextContent('View');
    expect(screen.getByTestId('account-permission-monitors')).toHaveTextContent('Edit');
    expect(screen.getByTestId('account-permission-stream')).toHaveTextContent('None');
  });

  it('says a column is undetermined rather than inventing a level', () => {
    // An account below System View cannot read its own row, so everything but
    // System stays genuinely unknown.
    mockPermissions = SYSTEM_NONE_PERMISSIONS;

    render(<AccountPermissionsCard profileId={profileId} />);

    expect(screen.getByTestId('account-permission-system')).toHaveTextContent('None');
    expect(screen.getByTestId('account-permission-events')).toHaveTextContent(
      'server.permission_unknown',
    );
  });

  it('shows nothing until the probe settles', () => {
    mockPermissions = undefined;
    mockLoading = true;

    render(<AccountPermissionsCard profileId={profileId} />);

    expect(screen.queryByTestId('account-permissions-card')).not.toBeInTheDocument();
    mockLoading = false;
  });
});
