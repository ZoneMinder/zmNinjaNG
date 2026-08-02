import { describe, it, expect } from 'vitest';
import { resolveFallbackFids, buildThumbnailChain, eventHasAlarmFrame } from '../thumbnail-chain';
import type { ThumbnailFallbackEntry } from '../../../stores/settings';

describe('resolveFallbackFids', () => {
  it('returns enabled entries in order', () => {
    const chain: ThumbnailFallbackEntry[] = [
      { type: 'alarm', enabled: true },
      { type: 'snapshot', enabled: true },
      { type: 'objdetect', enabled: true },
    ];
    expect(resolveFallbackFids(chain)).toEqual(['alarm', 'snapshot', 'objdetect']);
  });

  it('skips disabled entries', () => {
    const chain: ThumbnailFallbackEntry[] = [
      { type: 'alarm', enabled: false },
      { type: 'snapshot', enabled: true },
      { type: 'objdetect', enabled: false },
    ];
    expect(resolveFallbackFids(chain)).toEqual(['snapshot']);
  });

  it('includes custom entry only when enabled and non-empty', () => {
    const chain: ThumbnailFallbackEntry[] = [
      { type: 'custom', enabled: true, customFid: 'hd_snapshot' },
    ];
    expect(resolveFallbackFids(chain)).toEqual(['hd_snapshot']);
  });

  it('skips enabled custom entry with empty fid', () => {
    const chain: ThumbnailFallbackEntry[] = [
      { type: 'snapshot', enabled: true },
      { type: 'custom', enabled: true, customFid: '' },
    ];
    expect(resolveFallbackFids(chain)).toEqual(['snapshot']);
  });

  it('skips enabled custom entry with whitespace-only fid', () => {
    const chain: ThumbnailFallbackEntry[] = [
      { type: 'custom', enabled: true, customFid: '   ' },
    ];
    expect(resolveFallbackFids(chain)).toEqual([]);
  });

  it('skips disabled custom entry even with a fid set', () => {
    const chain: ThumbnailFallbackEntry[] = [
      { type: 'custom', enabled: false, customFid: 'hd_snapshot' },
    ];
    expect(resolveFallbackFids(chain)).toEqual([]);
  });

  it('trims custom fid whitespace', () => {
    const chain: ThumbnailFallbackEntry[] = [
      { type: 'custom', enabled: true, customFid: '  hd_snap  ' },
    ];
    expect(resolveFallbackFids(chain)).toEqual(['hd_snap']);
  });

  it('returns empty array for empty chain', () => {
    expect(resolveFallbackFids([])).toEqual([]);
  });
});

describe('buildThumbnailChain', () => {
  it('builds URLs for each enabled fid', () => {
    const chain: ThumbnailFallbackEntry[] = [
      { type: 'alarm', enabled: true },
      { type: 'snapshot', enabled: true },
    ];
    const urls = buildThumbnailChain('https://zm.example.com/zm', '42', chain, {
      token: 'tok',
      width: 300,
    }).map((u) => decodeURIComponent(u));
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('eid=42');
    expect(urls[0]).toContain('fid=alarm');
    expect(urls[0]).toContain('token=tok');
    expect(urls[0]).toContain('width=300');
    expect(urls[1]).toContain('fid=snapshot');
  });

  it('builds URL with custom fid', () => {
    const chain: ThumbnailFallbackEntry[] = [
      { type: 'custom', enabled: true, customFid: 'hd_snapshot' },
    ];
    const [url] = buildThumbnailChain('https://zm.example.com/zm', '42', chain);
    expect(decodeURIComponent(url)).toContain('fid=hd_snapshot');
  });

  it('returns empty array when no entries are enabled', () => {
    const chain: ThumbnailFallbackEntry[] = [
      { type: 'alarm', enabled: false },
      { type: 'snapshot', enabled: false },
    ];
    expect(buildThumbnailChain('https://zm.example.com/zm', '42', chain)).toEqual([]);
  });
});

describe('skipping the alarm frame an event does not have', () => {
  const chain: ThumbnailFallbackEntry[] = [
    { type: 'alarm', enabled: true },
    { type: 'snapshot', enabled: true },
  ];

  it('drops the alarm fid when the event recorded no alarm frames', () => {
    expect(resolveFallbackFids(chain, { hasAlarmFrame: false })).toEqual(['snapshot']);
  });

  it('keeps the alarm fid when the event recorded alarm frames', () => {
    expect(resolveFallbackFids(chain, { hasAlarmFrame: true })).toEqual(['alarm', 'snapshot']);
  });

  it('keeps the alarm fid when the caller cannot say, so nothing regresses', () => {
    expect(resolveFallbackFids(chain)).toEqual(['alarm', 'snapshot']);
  });

  it('builds no alarm URL for an event with no alarm frames', () => {
    // Decoded first: under dev the real URL is nested percent-encoded inside
    // the image proxy, so a raw substring check would never match.
    const urls = buildThumbnailChain('https://zm.example/zm', '42', chain, {
      hasAlarmFrame: false,
    }).map(decodeURIComponent);
    expect(urls.some((url) => url.includes('fid=alarm'))).toBe(false);
    expect(urls.some((url) => url.includes('fid=snapshot'))).toBe(true);
  });
});

describe('eventHasAlarmFrame', () => {
  it('reads the recorded alarm frame count', () => {
    expect(eventHasAlarmFrame({ AlarmFrames: '3' })).toBe(true);
    expect(eventHasAlarmFrame({ AlarmFrames: '0' })).toBe(false);
  });

  it('assumes an alarm frame when the count is missing or unparsable', () => {
    // Better one wasted request than a silently missing alarm thumbnail.
    expect(eventHasAlarmFrame({})).toBe(true);
    expect(eventHasAlarmFrame({ AlarmFrames: '' })).toBe(true);
  });
});
