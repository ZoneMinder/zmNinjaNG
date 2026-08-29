/**
 * API schema drift tolerance (refs #247).
 *
 * ZoneMinder changes what it sends between releases, and these schemas are the
 * only thing standing between that and a blank screen. Zod strips fields we do
 * not declare, so a genuinely NEW field is harmless. The danger is the reverse:
 * a field we declared, whose type drifts, fails the whole response and takes
 * every monitor with it.
 *
 * These tests use real payloads from bug reports, not invented ones.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  MonitorSchema,
  MonitorsResponseSchema,
  EventSchema,
  ConfigSchema,
  ZMLogSchema,
  StateSchema,
  ZoneSchema,
  GroupSchema,
  TagSchema,
  ZMControlSchema,
  ZMNotificationSchema,
  ZMNotificationResponseSchema,
} from '../types';

/** A ZM 1.38.3 Ffmpeg monitor, trimmed from the raw response in #247. */
function zm1383Monitor(overrides: Record<string, unknown> = {}) {
  return {
    Id: 2,
    Name: 'Cam-1',
    Deleted: false,
    Notes: null,
    ServerId: 6,
    StorageId: 0,
    Type: 'Ffmpeg',
    Function: 'Record',
    Capturing: 'Always',
    Enabled: 0,
    Decoding: 'Always',
    Go2RTCEnabled: false,
    RTSP2WebEnabled: false,
    RTSP2WebType: 'WebRTC',
    StreamChannel: 'CameraDirectPrimary',
    DefaultPlayer: '',
    JanusEnabled: false,
    Restream: false,
    RTSP_User: null,
    LinkedMonitors: null,
    Triggers: null,
    Device: null,
    Channel: null,
    Format: null,
    V4LCapturesPerFrame: null,
    Protocol: null,
    Method: null,
    Width: 1920,
    Height: 1080,
    ControlId: null,
    TrackDelay: null,
    ReturnDelay: null,
    ...overrides,
  };
}

describe('MonitorSchema drift tolerance', () => {
  // The exact failure in #247: ZM 1.38.3 serializes V4LMultiBuffer as boolean
  // false or null (never the integer the DB holds), on EVERY camera type
  // including Ffmpeg. The schema said z.string().nullable(), so `false` threw
  // and the user's whole monitor list failed to load.
  describe('V4LMultiBuffer (#247)', () => {
    it.each([
      ['false (ZM 1.38.3 for a DB 0)', false],
      ['null (ZM 1.38.3 for a DB NULL)', null],
      ['0 (integer, what the DB holds)', 0],
      ['1 (integer)', 1],
      ['"0" (string, older ZM)', '0'],
      ['true (boolean)', true],
      ['absent entirely', undefined],
    ])('parses a monitor whose V4LMultiBuffer is %s', (_label, value) => {
      const raw = zm1383Monitor(value === undefined ? {} : { V4LMultiBuffer: value });
      const result = MonitorSchema.safeParse(raw);
      expect(result.success).toBe(true);
    });
  });

  // The reporter suspected these too. They already coerce and allow null, so
  // they were never the failure; this pins that down so it stays true.
  describe('fields that arrive as null on monitors with no events', () => {
    it.each(['ControlId', 'TrackDelay', 'ReturnDelay'])('parses a null %s', (field) => {
      const result = MonitorSchema.safeParse(zm1383Monitor({ [field]: null }));
      expect(result.success).toBe(true);
    });

    it.each(['ControlId', 'TrackDelay', 'ReturnDelay'])('parses an integer %s', (field) => {
      const result = MonitorSchema.safeParse(zm1383Monitor({ [field]: 0 }));
      expect(result.success).toBe(true);
    });
  });

  // Zod strips unknown keys, so this passes today. It is the guarantee the
  // whole policy rests on, and a stray .strict() anywhere would silently
  // revoke it, so it gets a test rather than a comment.
  describe('fields ZoneMinder adds that we never declared', () => {
    it('ignores unknown fields instead of failing', () => {
      const result = MonitorSchema.safeParse(
        zm1383Monitor({
          SomeFieldFromZoneMinder2027: { nested: ['anything', 1, true] },
          AnotherNewField: 'whatever',
        }),
      );
      expect(result.success).toBe(true);
    });

    it('ignores an unknown Event_Summary block of all nulls (#247)', () => {
      // ZM returns this for monitors with zero events. Not declared, so it is
      // dropped rather than parsed.
      const result = MonitorsResponseSchema.safeParse({
        monitors: [
          {
            Monitor: zm1383Monitor(),
            Event_Summary: {
              MonitorId: null, TotalEvents: null, TotalEventDiskSpace: null,
              HourEvents: null, DayEvents: null, WeekEvents: null, MonthEvents: null,
              ArchivedEvents: null, ArchivedEventDiskSpace: null,
            },
          },
        ],
      });
      expect(result.success).toBe(true);
    });
  });

  // The policy, stated as a test rather than a comment: NO declared field may
  // fail the response, whatever type ZoneMinder gives it. This is the guard
  // that stops the next V4LMultiBuffer, in whichever field it turns up.
  describe('no single declared field can fail the response', () => {
    const drift = [
      ['a boolean', false],
      ['a number', 0],
      ['a string', 'unexpected'],
      ['null', null],
      ['an object', { nested: true }],
      ['an array', [1, 2]],
    ] as const;
    // Every field the schema declares, minus the two that identify the monitor
    // and are handled by the drop-the-row test below.
    const fields = Object.keys(zm1383Monitor()).filter((f) => f !== 'Id' && f !== 'Name');

    it.each(drift)('survives every field arriving as %s', (_label, value) => {
      for (const field of fields) {
        const result = MonitorSchema.safeParse(zm1383Monitor({ [field]: value }));
        expect(result.success, `${field} = ${JSON.stringify(value)} must not fail the parse`).toBe(true);
      }
    });

    it('survives every field being absent', () => {
      for (const field of fields) {
        const raw = zm1383Monitor();
        delete (raw as Record<string, unknown>)[field];
        const result = MonitorSchema.safeParse(raw);
        expect(result.success, `a missing ${field} must not fail the parse`).toBe(true);
      }
    });
  });

  // Mode values are z.string(), not z.enum(): a ZM release that adds one must
  // not blank the screen, and an enum with .catch('None') would be worse than
  // failing, since it would report a recording camera as switched off.
  describe('mode fields tolerate values ZoneMinder has not shipped yet', () => {
    it.each(['Function', 'Capturing', 'Analysing', 'Recording'])(
      'keeps an unknown %s value instead of failing or rewriting it',
      (field) => {
        const result = MonitorSchema.safeParse(zm1383Monitor({ [field]: 'SomeNewMode' }));
        expect(result.success).toBe(true);
        expect(result.success && (result.data as Record<string, unknown>)[field]).toBe('SomeNewMode');
      },
    );
  });

  describe('a monitor with no usable identity', () => {
    it('is dropped without taking the other monitors with it', () => {
      const result = MonitorsResponseSchema.safeParse({
        monitors: [
          { Monitor: zm1383Monitor({ Id: 2, Name: 'Good' }) },
          { Monitor: zm1383Monitor({ Id: undefined, Name: undefined }) },
          { Monitor: zm1383Monitor({ Id: 4, Name: 'Also good' }) },
        ],
      });
      expect(result.success).toBe(true);
      expect(result.success && result.data.monitors.map((m) => m.Monitor.Name)).toEqual([
        'Good',
        'Also good',
      ]);
    });

    it('does not fail the response when the row is not even an object', () => {
      const result = MonitorsResponseSchema.safeParse({
        monitors: [{ Monitor: zm1383Monitor() }, 'garbage', null],
      });
      expect(result.success).toBe(true);
      expect(result.success && result.data.monitors).toHaveLength(1);
    });
  });

  it('keeps an unknown zone type instead of failing (ZoneType widened, #247)', () => {
    const result = ZoneSchema.safeParse({
      Id: 1, MonitorId: 1, Name: 'z', Type: 'SomeFutureZoneType', NumCoords: 4, Coords: '0,0',
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.Type).toBe('SomeFutureZoneType');
  });

  // One camera ZoneMinder describes oddly must not blank out the others: the
  // report in #247 was a whole list lost to one field on some of the cameras.
  it('parses a mixed list where V4LMultiBuffer differs per monitor', () => {
    const result = MonitorsResponseSchema.safeParse({
      monitors: [
        { Monitor: zm1383Monitor({ Id: 2, V4LMultiBuffer: null }) },
        { Monitor: zm1383Monitor({ Id: 3, V4LMultiBuffer: false }) },
        { Monitor: zm1383Monitor({ Id: 4, V4LMultiBuffer: 0 }) },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.monitors).toHaveLength(3);
  });
});

/**
 * The policy, enforced across every entity schema at once (rule 43).
 *
 * For each schema it reads the declared field names off the schema's own shape,
 * then drives every non-identity field through every JSON type ZoneMinder could
 * plausibly send, plus absence. None may fail the parse. This is what stops the
 * next V4LMultiBuffer in whichever schema and whichever field it lands.
 *
 * Deriving the field list from `.shape` means a field added later is covered
 * automatically: there is no list here to forget to update.
 */
describe('no declared field can fail any entity response', () => {
  const drift = [false, 0, 1, 'x', null, { nested: true }, [1, 2]] as const;

  const cases: Array<{ name: string; schema: z.ZodObject; sample: Record<string, unknown>; identity: string[] }> = [
    {
      name: 'Monitor',
      schema: MonitorSchema as unknown as z.ZodObject,
      sample: { Id: 2, Name: 'Cam' },
      identity: ['Id', 'Name'],
    },
    {
      name: 'Event',
      schema: EventSchema as unknown as z.ZodObject,
      sample: { Id: 42, MonitorId: 1, Name: 'ev', StartDateTime: '2026-01-01 00:00:00' },
      identity: ['Id', 'Name'],
    },
    {
      name: 'Config',
      schema: ConfigSchema as unknown as z.ZodObject,
      sample: { Id: 1, Name: 'ZM_X', Value: 'v', Type: 'string', Category: 'system' },
      identity: ['Id', 'Name'],
    },
    {
      name: 'ZMLog',
      schema: ZMLogSchema as unknown as z.ZodObject,
      sample: { Id: 1, TimeKey: '1', Component: 'zmc', Level: 1, Code: 'INF', Message: 'm' },
      identity: ['Id'],
    },
    {
      name: 'State',
      schema: StateSchema as unknown as z.ZodObject,
      sample: { Id: 1, Name: 'default', Definition: '', IsActive: 1 },
      identity: ['Id', 'Name'],
    },
    {
      name: 'Zone',
      schema: ZoneSchema as unknown as z.ZodObject,
      sample: { Id: 1, MonitorId: 1, Name: 'z', Type: 'Active', NumCoords: 4, Coords: '0,0' },
      identity: ['Id', 'Name'],
    },
    {
      name: 'Group',
      schema: GroupSchema as unknown as z.ZodObject,
      sample: { Id: 1, Name: 'Outside', ParentId: null },
      identity: ['Id', 'Name'],
    },
    {
      name: 'Tag',
      schema: TagSchema as unknown as z.ZodObject,
      sample: { Id: 1, Name: 'person' },
      identity: ['Id', 'Name'],
    },
    {
      name: 'ZMControl',
      schema: ZMControlSchema as unknown as z.ZodObject,
      sample: { Id: 1, Name: 'PTZ', Type: 'Pelco', Protocol: 'rs485' },
      identity: ['Id', 'Name'],
    },
    {
      name: 'ZMNotification',
      schema: ZMNotificationSchema as unknown as z.ZodObject,
      sample: {
        Id: 7,
        UserId: 1,
        Token: 'tok',
        Platform: 'android',
        MonitorList: '1,2',
        Interval: 30,
        PushState: 'enabled',
        AppVersion: '2.2.1',
        BadgeCount: 0,
        LastNotifiedAt: null,
        CreatedOn: '2026-01-01 00:00:00',
        UpdatedOn: '2026-01-01 00:00:00',
      },
      identity: ['Id'],
    },
  ];

  for (const { name, schema, sample, identity } of cases) {
    describe(name, () => {
      it('has a valid baseline sample', () => {
        expect(schema.safeParse(sample).success).toBe(true);
      });

      const fields = Object.keys(schema.shape).filter((f) => !identity.includes(f));

      it.each(drift)(`survives every field set to %o`, (value) => {
        for (const field of fields) {
          const raw = { ...sample, [field]: value };
          expect(schema.safeParse(raw).success, `${name}.${field} = ${JSON.stringify(value)} must not fail`).toBe(true);
        }
      });

      it('survives every non-identity field being absent', () => {
        for (const field of fields) {
          const raw = { ...sample };
          delete raw[field];
          expect(schema.safeParse(raw).success, `${name} missing ${field} must not fail`).toBe(true);
        }
      });
    });
  }
});

/**
 * Direct-mode push registration reads `notification.Notification` straight off
 * the response. A ZoneMinder without the endpoint (PR #4685), or a proxy
 * answering 200 with an HTML error page, used to reach that property access
 * and throw "Cannot read properties of undefined", which landed in a log-only
 * catch and told the user nothing.
 */
describe('ZMNotificationResponseSchema rejects a body that is not a registration', () => {
  const notRegistrations = [
    { name: 'proxy HTML error page', body: '<html><body>502</body></html>' },
    { name: 'server without the endpoint', body: { success: false } },
    { name: 'envelope with no Notification', body: { notification: {} } },
    { name: 'registration with no Id', body: { notification: { Notification: { Token: 't' } } } },
  ];

  for (const { name, body } of notRegistrations) {
    it(`fails closed on ${name}`, () => {
      expect(ZMNotificationResponseSchema.safeParse(body).success).toBe(false);
    });
  }

  it('accepts a real registration and coerces the string id ZM sends', () => {
    const parsed = ZMNotificationResponseSchema.parse({
      notification: { Notification: { Id: '7', Token: 'tok', Platform: 'android' } },
    });
    expect(parsed.notification.Notification.Id).toBe(7);
  });
});
