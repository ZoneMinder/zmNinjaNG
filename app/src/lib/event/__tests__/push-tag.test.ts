import { describe, it, expect } from 'vitest';
import { parseEidFromPushTag } from '../push-tag';

describe('parseEidFromPushTag', () => {
  it('extracts the eid from the stacked-mode tag zmninja_<eid>_<event_type>', () => {
    expect(parseEidFromPushTag('zmninja_782846_event_start')).toBe('782846');
    expect(parseEidFromPushTag('zmninja_782846_event_end')).toBe('782846');
  });

  it('extracts the eid from a tag with no event_type suffix', () => {
    expect(parseEidFromPushTag('zmninja_782846')).toBe('782846');
  });

  it('returns null for the replace-mode constant tag (no event id in it)', () => {
    expect(parseEidFromPushTag('zmninjapush')).toBeNull();
  });

  it('returns null for empty, null, or unrelated tags', () => {
    expect(parseEidFromPushTag(undefined)).toBeNull();
    expect(parseEidFromPushTag(null)).toBeNull();
    expect(parseEidFromPushTag('')).toBeNull();
    expect(parseEidFromPushTag('some-other-app-tag')).toBeNull();
  });
});
