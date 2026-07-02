import { describe, it, expect } from 'vitest';
import { parseDetectedObjects } from '../event-detection';

describe('parseDetectedObjects', () => {
  it('returns [] for null/empty/no-match', () => {
    expect(parseDetectedObjects(null)).toEqual([]);
    expect(parseDetectedObjects('')).toEqual([]);
    expect(parseDetectedObjects('Motion: All')).toEqual([]);
  });
  it('parses a single detected object, stripping the |motion suffix', () => {
    expect(parseDetectedObjects('detected:person|Motion: All')).toEqual(['person']);
  });
  it('parses multiple detected objects', () => {
    expect(parseDetectedObjects('detected:person,car|Motion: All')).toEqual(['person', 'car']);
  });
  it('is case-insensitive on the detected: prefix', () => {
    expect(parseDetectedObjects('Detected:dog')).toEqual(['dog']);
  });
});
