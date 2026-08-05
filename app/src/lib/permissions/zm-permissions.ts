/**
 * What the logged-in ZoneMinder account is allowed to do.
 *
 * ZoneMinder has no "current user permissions" endpoint. `/host/login.json`
 * returns tokens only, and the JWT payload carries the username and nothing
 * else. The permission columns live on the Users row, and `UsersController`
 * gates `users.json` on `System() != 'None'` - so an account can read its own
 * permissions only when it has some system access to begin with.
 *
 * That is why every capability here answers with three states instead of a
 * boolean. `denied` means ZoneMinder told us no and a surface may hide or grey
 * itself; `unknown` means we never found out and the surface must behave as it
 * always has, leaving the write to fail honestly. Guessing in the `unknown`
 * case is how you take a feature away from someone who has it: `System='None'`
 * with `Monitors='Edit'` is a legal ZoneMinder account.
 *
 * A refused probe is still knowledge: a 401 from `users.json` proves `System`
 * is `'None'`, which is why {@link SYSTEM_NONE_PERMISSIONS} fills that one
 * field in and leaves the rest unknown.
 */

/** The levels ZoneMinder stores in a permission column. */
export const ZM_PERMISSION_LEVELS = ['None', 'View', 'Edit', 'Create'] as const;

export type ZmPermissionLevel = (typeof ZM_PERMISSION_LEVELS)[number];

/**
 * One account's permission columns. Every field but `system` is optional
 * because a refused probe leaves them unknown, and `undefined` has to stay
 * distinguishable from `'None'`.
 */
export interface ZmPermissions {
  /**
   * Known in the two cases that matter: read from the row, or proven `'None'`
   * by a 401. Still optional, because a ZoneMinder that omits or renames the
   * column has to read as unknown rather than as a denial.
   */
  system?: ZmPermissionLevel;
  monitors?: ZmPermissionLevel;
  stream?: ZmPermissionLevel;
  events?: ZmPermissionLevel;
  control?: ZmPermissionLevel;
  groups?: ZmPermissionLevel;
}

/**
 * `allowed` and `denied` are answers; `unknown` is the absence of one. Only
 * `denied` may drive hiding or greying.
 */
export type PermissionVerdict = 'allowed' | 'denied' | 'unknown';

/**
 * A profile with no username talks to a server with `ZM_OPT_USE_AUTH` off,
 * where every check short-circuits on `!$user`. Unrestricted, not unknown.
 */
export const UNRESTRICTED_PERMISSIONS: ZmPermissions = {
  system: 'Edit',
  monitors: 'Edit',
  stream: 'Edit',
  events: 'Edit',
  control: 'Edit',
  groups: 'Edit',
};

/** What a 401 from `users.json` tells us, and no more. */
export const SYSTEM_NONE_PERMISSIONS: ZmPermissions = { system: 'None' };

const LEVEL_RANK: Record<ZmPermissionLevel, number> = {
  None: 0,
  View: 1,
  Edit: 2,
  Create: 3,
};

/**
 * Reads a permission column, reporting anything unrecognized as unknown.
 *
 * A level this app has not heard of must not read as a denial: the safe
 * failure is to leave the surface alone and let the write speak for itself.
 */
export function parsePermissionLevel(value: unknown): ZmPermissionLevel | undefined {
  return ZM_PERMISSION_LEVELS.find((level) => level === value);
}

function atLeast(
  level: ZmPermissionLevel | undefined,
  minimum: ZmPermissionLevel,
): PermissionVerdict {
  if (level === undefined) return 'unknown';
  return LEVEL_RANK[level] >= LEVEL_RANK[minimum] ? 'allowed' : 'denied';
}

/**
 * Whether the monitor settings dialog may edit ZoneMinder fields.
 *
 * Keyed on `System` rather than `Monitors` by product decision (refs #344):
 * the dialog carries camera credentials, so it opens for administrators only.
 * `Monitors` still decides whether a save succeeds, which is what the
 * permission-denied latch is for.
 */
export function canEditMonitorSettings(
  permissions: ZmPermissions | undefined,
): PermissionVerdict {
  return atLeast(permissions?.system, 'Edit');
}

/**
 * Whether live streams will play.
 *
 * `zms.cpp` checks `Stream` for a monitor source, independently of `Monitors`.
 * A denied stream is an image that never loads, with no request to catch
 * failing, so this is the one capability nothing but the probe can report.
 */
export function canViewStream(permissions: ZmPermissions | undefined): PermissionVerdict {
  return atLeast(permissions?.stream, 'View');
}

/** Whether events can be archived, edited, or deleted. */
export function canEditEvents(permissions: ZmPermissions | undefined): PermissionVerdict {
  return atLeast(permissions?.events, 'Edit');
}

/** Whether events can be listed and replayed at all. */
export function canViewEvents(permissions: ZmPermissions | undefined): PermissionVerdict {
  return atLeast(permissions?.events, 'View');
}

/**
 * Whether PTZ commands will be accepted.
 *
 * `ajax/control.php` gates on `canView('Control', id)`, so View is enough -
 * this is not an Edit-level capability despite being a write.
 */
export function canUseControl(permissions: ZmPermissions | undefined): PermissionVerdict {
  return atLeast(permissions?.control, 'View');
}

/**
 * Whether any monitor is visible at all.
 *
 * At `'None'` ZoneMinder returns an empty list rather than an error, so without
 * this the app would report a server with no cameras on it.
 */
export function canViewMonitors(permissions: ZmPermissions | undefined): PermissionVerdict {
  return atLeast(permissions?.monitors, 'View');
}

/** Whether `groups.json` will answer. Independent of monitor access. */
export function canViewGroups(permissions: ZmPermissions | undefined): PermissionVerdict {
  return atLeast(permissions?.groups, 'View');
}

/** Whether the system endpoints answer: `logs.json`, `states.json`, `servers.json`. */
export function canViewSystem(permissions: ZmPermissions | undefined): PermissionVerdict {
  return atLeast(permissions?.system, 'View');
}

/** Whether the run state can be changed. `StatesController` wants System Edit. */
export function canChangeRunState(permissions: ZmPermissions | undefined): PermissionVerdict {
  return atLeast(permissions?.system, 'Edit');
}
