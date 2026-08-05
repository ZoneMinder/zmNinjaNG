/**
 * Permission verdicts.
 *
 * The three-state model is the whole point: a surface must be able to tell
 * "ZoneMinder says no" from "we never found out", because only the first one
 * may hide or grey anything.
 */

import { describe, it, expect } from 'vitest';
import {
  UNRESTRICTED_PERMISSIONS,
  SYSTEM_NONE_PERMISSIONS,
  canEditMonitorSettings,
  canViewStream,
  canEditEvents,
  canViewEvents,
  canUseControl,
  canViewGroups,
  canViewLogs,
  canChangeRunState,
  parsePermissionLevel,
  type ZmPermissions,
} from '../zm-permissions';

/** A user with every permission ZoneMinder grants. */
const admin: ZmPermissions = {
  system: 'Edit',
  monitors: 'Edit',
  stream: 'Edit',
  events: 'Edit',
  control: 'Edit',
  groups: 'Edit',
};

/** Can watch cameras, change nothing. */
const viewer: ZmPermissions = {
  system: 'View',
  monitors: 'View',
  stream: 'View',
  events: 'View',
  control: 'None',
  groups: 'View',
};

describe('parsePermissionLevel', () => {
  it('accepts the levels ZoneMinder stores', () => {
    expect(parsePermissionLevel('None')).toBe('None');
    expect(parsePermissionLevel('View')).toBe('View');
    expect(parsePermissionLevel('Edit')).toBe('Edit');
    expect(parsePermissionLevel('Create')).toBe('Create');
  });

  it('reports an unrecognized level as unknown rather than denying', () => {
    // A level this app has not heard of must not lock a user out of a surface
    // they may well be entitled to.
    expect(parsePermissionLevel('Superuser')).toBeUndefined();
    expect(parsePermissionLevel(undefined)).toBeUndefined();
    expect(parsePermissionLevel('')).toBeUndefined();
  });
});

describe('verdicts before the probe lands', () => {
  it('is unknown for every capability', () => {
    expect(canEditMonitorSettings(undefined)).toBe('unknown');
    expect(canViewStream(undefined)).toBe('unknown');
    expect(canEditEvents(undefined)).toBe('unknown');
    expect(canUseControl(undefined)).toBe('unknown');
    expect(canViewGroups(undefined)).toBe('unknown');
    expect(canViewLogs(undefined)).toBe('unknown');
    expect(canChangeRunState(undefined)).toBe('unknown');
  });
});

describe('monitor settings', () => {
  it('allows editing only at System Edit', () => {
    expect(canEditMonitorSettings(admin)).toBe('allowed');
    expect(canEditMonitorSettings(viewer)).toBe('denied');
  });

  it('denies editing when users.json refused the probe', () => {
    // A 401 on users.json proves System is 'None' (UsersController gates on
    // System() != 'None'), so this branch is knowledge, not a guess.
    expect(canEditMonitorSettings(SYSTEM_NONE_PERMISSIONS)).toBe('denied');
  });

  it('leaves the other capabilities unknown after a refused probe', () => {
    expect(canViewStream(SYSTEM_NONE_PERMISSIONS)).toBe('unknown');
    expect(canEditEvents(SYSTEM_NONE_PERMISSIONS)).toBe('unknown');
    expect(canUseControl(SYSTEM_NONE_PERMISSIONS)).toBe('unknown');
    expect(canViewGroups(SYSTEM_NONE_PERMISSIONS)).toBe('unknown');
  });
});

describe('streaming', () => {
  it('separates watching a camera from listing it', () => {
    // Monitors View with Stream None is the case no failing request can catch:
    // the monitor appears everywhere and every stream 403s.
    expect(canViewStream({ system: 'None', monitors: 'View', stream: 'None' })).toBe('denied');
    expect(canViewStream({ system: 'None', monitors: 'View', stream: 'View' })).toBe('allowed');
  });
});

describe('events', () => {
  it('requires Edit to archive or delete, View to read', () => {
    expect(canEditEvents(admin)).toBe('allowed');
    expect(canEditEvents(viewer)).toBe('denied');
    expect(canViewEvents(viewer)).toBe('allowed');
    expect(canViewEvents({ system: 'None', events: 'None' })).toBe('denied');
  });
});

describe('PTZ control', () => {
  it('denies at None and allows from View up', () => {
    // ajax/control.php gates on canView('Control', id), not canEdit.
    expect(canUseControl(viewer)).toBe('denied');
    expect(canUseControl({ system: 'None', control: 'View' })).toBe('allowed');
  });
});

describe('system surfaces', () => {
  it('lets a View user read logs but not change the run state', () => {
    expect(canViewLogs(viewer)).toBe('allowed');
    expect(canChangeRunState(viewer)).toBe('denied');
    expect(canViewLogs(SYSTEM_NONE_PERMISSIONS)).toBe('denied');
    expect(canChangeRunState(admin)).toBe('allowed');
  });
});

describe('groups', () => {
  it('is its own column, independent of monitor access', () => {
    expect(canViewGroups({ system: 'None', monitors: 'Edit', groups: 'None' })).toBe('denied');
    expect(canViewGroups(admin)).toBe('allowed');
  });
});

describe('a server with authentication disabled', () => {
  it('allows everything', () => {
    // ZoneMinder short-circuits every check with `!$user`, so a profile with
    // no username is unrestricted rather than unknown.
    expect(canEditMonitorSettings(UNRESTRICTED_PERMISSIONS)).toBe('allowed');
    expect(canViewStream(UNRESTRICTED_PERMISSIONS)).toBe('allowed');
    expect(canEditEvents(UNRESTRICTED_PERMISSIONS)).toBe('allowed');
    expect(canUseControl(UNRESTRICTED_PERMISSIONS)).toBe('allowed');
    expect(canChangeRunState(UNRESTRICTED_PERMISSIONS)).toBe('allowed');
  });
});

describe('Create outranks Edit', () => {
  it('treats a monitor-creating user as able to edit', () => {
    expect(canEditEvents({ system: 'None', events: 'Create' })).toBe('allowed');
  });
});
