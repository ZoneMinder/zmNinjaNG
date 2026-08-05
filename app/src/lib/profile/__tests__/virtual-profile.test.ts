import { describe, expect, it } from 'vitest';
import { countActiveMembers } from '../virtual-profile';
import { asProfileId, mintVirtualProfileId } from '../../../api/types';
import type { Profile } from '../../../api/types';

const profile = (id: string, disabled = false): Profile =>
  ({ id: asProfileId(id), name: id, disabled }) as Profile;

const group = (...members: string[]) => ({
  id: mintVirtualProfileId(),
  name: 'Backyard',
  memberProfileIds: members.map(asProfileId),
});

describe('countActiveMembers', () => {
  it('counts the members that exist and are enabled', () => {
    expect(countActiveMembers(group('p1', 'p2'), [profile('p1'), profile('p2')])).toBe(2);
  });

  it('drops a disabled member', () => {
    expect(countActiveMembers(group('p1', 'p2'), [profile('p1'), profile('p2', true)])).toBe(1);
  });

  // Storage can name a profile that no longer exists (deleted in another tab,
  // hand-edited), and useProfileScope drops those too.
  it('drops a member no profile answers to', () => {
    expect(countActiveMembers(group('p1', 'gone'), [profile('p1')])).toBe(1);
    expect(countActiveMembers(group('gone'), [profile('p1')])).toBe(0);
  });
});
