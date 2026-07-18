/**
 * Destructive assistant tools (refs #246).
 *
 * Every tool here sets `destructive: true` and provides `buildConfirm`, which
 * only builds the `ConfirmRequest` for the host to show a confirmation card.
 * It never calls `ctx.host.confirm` itself: that belongs to the agent loop
 * (a later task), which calls `buildConfirm`, shows the card, and only then
 * calls `execute` if the user approves.
 */
import { triggerAlarm, cancelAlarm, setMonitorEnabled, changeMonitorFunction } from '../../api/monitors';
import { changeState } from '../../api/states';
import { getEvent, deleteEvent, setEventArchived } from '../../api/events';
import type { ToolDefinition } from './types';
import { safeExecute } from './tool-helpers';

const MONITOR_FUNCTIONS = ['None', 'Monitor', 'Modect', 'Record', 'Mocord', 'Nodect'] as const;

function requireId(value: unknown, name: string): string {
  const id = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  if (!/^\d+$/.test(id)) throw new Error(name + ' must be a numeric id');
  return id;
}

function requireBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(name + ' must be a boolean');
  return value;
}

function requireMonitorFunction(value: unknown): (typeof MONITOR_FUNCTIONS)[number] {
  if (typeof value !== 'string' || !MONITOR_FUNCTIONS.includes(value as (typeof MONITOR_FUNCTIONS)[number])) {
    throw new Error('func must be one of: ' + MONITOR_FUNCTIONS.join(', '));
  }
  return value as (typeof MONITOR_FUNCTIONS)[number];
}

function requireState(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('state is required');
  return value.trim();
}

const triggerAlarmTool: ToolDefinition = {
  name: 'trigger_alarm',
  description: 'Force a monitor into alarm state. Requires confirmation.',
  schema: {
    type: 'object',
    properties: { monitorId: { type: 'string' } },
    required: ['monitorId'],
  },
  destructive: true,
  async buildConfirm(input) {
    const monitorId = requireId(input.monitorId, 'monitorId');
    return {
      toolName: 'trigger_alarm',
      messageKey: 'assistant.confirm.trigger_alarm',
      messageParams: { monitorId },
      params: { monitorId },
    };
  },
  execute: (input, _ctx) =>
    safeExecute('trigger_alarm', async () => {
      await triggerAlarm(requireId(input.monitorId, 'monitorId'));
      return 'done';
    }),
};

const cancelAlarmTool: ToolDefinition = {
  name: 'cancel_alarm',
  description: 'Cancel a monitor\'s forced alarm state. Requires confirmation.',
  schema: {
    type: 'object',
    properties: { monitorId: { type: 'string' } },
    required: ['monitorId'],
  },
  destructive: true,
  async buildConfirm(input) {
    const monitorId = requireId(input.monitorId, 'monitorId');
    return {
      toolName: 'cancel_alarm',
      messageKey: 'assistant.confirm.cancel_alarm',
      messageParams: { monitorId },
      params: { monitorId },
    };
  },
  execute: (input, _ctx) =>
    safeExecute('cancel_alarm', async () => {
      await cancelAlarm(requireId(input.monitorId, 'monitorId'));
      return 'done';
    }),
};

const setMonitorEnabledTool: ToolDefinition = {
  name: 'set_monitor_enabled',
  description: 'Enable or disable (arm/disarm) a monitor. Requires confirmation.',
  schema: {
    type: 'object',
    properties: { monitorId: { type: 'string' }, enabled: { type: 'boolean' } },
    required: ['monitorId', 'enabled'],
  },
  destructive: true,
  async buildConfirm(input) {
    const monitorId = requireId(input.monitorId, 'monitorId');
    const enabled = requireBoolean(input.enabled, 'enabled');
    return {
      toolName: 'set_monitor_enabled',
      // A distinct key per boolean value, rather than interpolating `enabled`
      // as a param: i18n string interpolation renders a raw boolean as the
      // literal "true"/"false" in every locale (refs #246 review).
      messageKey: enabled
        ? 'assistant.confirm.set_monitor_enabled_enable'
        : 'assistant.confirm.set_monitor_enabled_disable',
      messageParams: { id: monitorId },
      params: { monitorId, enabled },
    };
  },
  execute: (input, _ctx) =>
    safeExecute('set_monitor_enabled', async () => {
      await setMonitorEnabled(requireId(input.monitorId, 'monitorId'), requireBoolean(input.enabled, 'enabled'));
      return 'done';
    }),
};

const changeMonitorFunctionTool: ToolDefinition = {
  name: 'change_monitor_function',
  description:
    'Change a monitor\'s function (None/Monitor/Modect/Record/Mocord/Nodect). Requires confirmation.',
  schema: {
    type: 'object',
    properties: {
      monitorId: { type: 'string' },
      func: { type: 'string', enum: MONITOR_FUNCTIONS },
    },
    required: ['monitorId', 'func'],
  },
  destructive: true,
  async buildConfirm(input) {
    const monitorId = requireId(input.monitorId, 'monitorId');
    const func = requireMonitorFunction(input.func);
    return {
      toolName: 'change_monitor_function',
      messageKey: 'assistant.confirm.change_monitor_function',
      messageParams: { id: monitorId, func },
      params: { monitorId, func },
    };
  },
  execute: (input, _ctx) =>
    safeExecute('change_monitor_function', async () => {
      await changeMonitorFunction(
        requireId(input.monitorId, 'monitorId'),
        requireMonitorFunction(input.func),
      );
      return 'done';
    }),
};

const changeRunStateTool: ToolDefinition = {
  name: 'change_run_state',
  description: 'Change the ZoneMinder system run state (e.g. "Home", "Away"). Requires confirmation.',
  schema: {
    type: 'object',
    properties: { state: { type: 'string' } },
    required: ['state'],
  },
  destructive: true,
  async buildConfirm(input) {
    const state = requireState(input.state);
    return {
      toolName: 'change_run_state',
      messageKey: 'assistant.confirm.change_run_state',
      messageParams: { state },
      params: { state },
    };
  },
  execute: (input, _ctx) =>
    safeExecute('change_run_state', async () => {
      await changeState(requireState(input.state));
      return 'done';
    }),
};

const deleteEventTool: ToolDefinition = {
  name: 'delete_event',
  description: 'Permanently delete an event. Requires confirmation.',
  schema: {
    type: 'object',
    properties: { eventId: { type: 'string' } },
    required: ['eventId'],
  },
  destructive: true,
  async buildConfirm(input) {
    const eventId = requireId(input.eventId, 'eventId');
    const { Event } = await getEvent(eventId);
    return {
      toolName: 'delete_event',
      messageKey: 'assistant.confirm.delete_event',
      messageParams: { eventId, monitorId: Event.MonitorId, start: Event.StartDateTime },
      params: { eventId },
    };
  },
  execute: (input, _ctx) =>
    safeExecute('delete_event', async () => {
      await deleteEvent(requireId(input.eventId, 'eventId'));
      return 'done';
    }),
};

const archiveEventTool: ToolDefinition = {
  name: 'archive_event',
  description: 'Archive or unarchive an event, protecting or exposing it to retention cleanup. Requires confirmation.',
  schema: {
    type: 'object',
    properties: { eventId: { type: 'string' }, archived: { type: 'boolean' } },
    required: ['eventId', 'archived'],
  },
  destructive: true,
  async buildConfirm(input) {
    const eventId = requireId(input.eventId, 'eventId');
    const archived = requireBoolean(input.archived, 'archived');
    return {
      toolName: 'archive_event',
      // Same rationale as set_monitor_enabled above: a key per boolean value.
      messageKey: archived
        ? 'assistant.confirm.archive_event_archive'
        : 'assistant.confirm.archive_event_unarchive',
      messageParams: { eventId },
      params: { eventId, archived },
    };
  },
  execute: (input, _ctx) =>
    safeExecute('archive_event', async () => {
      await setEventArchived(requireId(input.eventId, 'eventId'), requireBoolean(input.archived, 'archived'));
      return 'done';
    }),
};

export const destructiveTools: ToolDefinition[] = [
  triggerAlarmTool,
  cancelAlarmTool,
  setMonitorEnabledTool,
  changeMonitorFunctionTool,
  changeRunStateTool,
  deleteEventTool,
  archiveEventTool,
];
