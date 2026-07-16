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
    return {
      toolName: 'trigger_alarm',
      messageKey: 'assistant.confirm.trigger_alarm',
      messageParams: { monitorId: input.monitorId },
      params: input,
    };
  },
  execute: (input, _ctx) =>
    safeExecute('trigger_alarm', async () => {
      await triggerAlarm(String(input.monitorId));
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
    return {
      toolName: 'cancel_alarm',
      messageKey: 'assistant.confirm.cancel_alarm',
      messageParams: { monitorId: input.monitorId },
      params: input,
    };
  },
  execute: (input, _ctx) =>
    safeExecute('cancel_alarm', async () => {
      await cancelAlarm(String(input.monitorId));
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
    return {
      toolName: 'set_monitor_enabled',
      messageKey: 'assistant.confirm.set_monitor_enabled',
      messageParams: { id: input.monitorId, enabled: input.enabled },
      params: input,
    };
  },
  execute: (input, _ctx) =>
    safeExecute('set_monitor_enabled', async () => {
      await setMonitorEnabled(String(input.monitorId), Boolean(input.enabled));
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
      func: { type: 'string', enum: ['None', 'Monitor', 'Modect', 'Record', 'Mocord', 'Nodect'] },
    },
    required: ['monitorId', 'func'],
  },
  destructive: true,
  async buildConfirm(input) {
    return {
      toolName: 'change_monitor_function',
      messageKey: 'assistant.confirm.change_monitor_function',
      messageParams: { id: input.monitorId, func: input.func },
      params: input,
    };
  },
  execute: (input, _ctx) =>
    safeExecute('change_monitor_function', async () => {
      await changeMonitorFunction(
        String(input.monitorId),
        input.func as 'None' | 'Monitor' | 'Modect' | 'Record' | 'Mocord' | 'Nodect',
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
    return {
      toolName: 'change_run_state',
      messageKey: 'assistant.confirm.change_run_state',
      messageParams: { state: input.state },
      params: input,
    };
  },
  execute: (input, _ctx) =>
    safeExecute('change_run_state', async () => {
      await changeState(String(input.state));
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
    const eventId = String(input.eventId);
    const { Event } = await getEvent(eventId);
    return {
      toolName: 'delete_event',
      messageKey: 'assistant.confirm.delete_event',
      messageParams: { eventId, monitorId: Event.MonitorId, start: Event.StartDateTime },
      params: input,
    };
  },
  execute: (input, _ctx) =>
    safeExecute('delete_event', async () => {
      await deleteEvent(String(input.eventId));
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
    return {
      toolName: 'archive_event',
      messageKey: 'assistant.confirm.archive_event',
      messageParams: { eventId: input.eventId, archived: input.archived },
      params: input,
    };
  },
  execute: (input, _ctx) =>
    safeExecute('archive_event', async () => {
      await setEventArchived(String(input.eventId), Boolean(input.archived));
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
