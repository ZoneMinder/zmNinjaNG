import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getObjectLabels, buildObjectLabelLine, __clearObjectLabelCacheForTests } from '../object-labels';
import { getEvents } from '../../../api/events';

vi.mock('../../../api/events', () => ({ getEvents: vi.fn() }));
vi.mock('../../../services/sessions', () => ({ getSession: vi.fn(() => ({ client: {} })) }));

const page = (notes: string[]) => ({
  events: notes.map((Notes, i) => ({ Event: { Id: String(i), MonitorId: '1', Notes } })),
  pagination: { page: 1, pageCount: 1, current: 1, count: notes.length, prevPage: false, nextPage: false, limit: 100, totalCount: notes.length },
});

describe('getObjectLabels', () => {
  beforeEach(() => {
    __clearObjectLabelCacheForTests();
    vi.mocked(getEvents).mockReset();
  });

  it('reads the labels this install actually writes, de-duped and sorted', async () => {
    vi.mocked(getEvents).mockResolvedValue(
      page(['detected:person|Motion', 'detected:car,truck|Motion', 'detected:person|Motion']) as never,
    );

    await expect(getObjectLabels('p1')).resolves.toEqual(['car', 'person', 'truck']);
  });

  it('caches per profile, so one vocabulary read serves a conversation', async () => {
    vi.mocked(getEvents).mockResolvedValue(page(['detected:person|Motion']) as never);

    await getObjectLabels('p1');
    await getObjectLabels('p1');
    expect(getEvents).toHaveBeenCalledTimes(1);

    // A different install must not inherit it.
    await getObjectLabels('p2');
    expect(getEvents).toHaveBeenCalledTimes(2);
  });

  // A fresh install with no events, or an unreachable server, must not break
  // the turn: the prompt simply says nothing about labels.
  it('returns nothing rather than throwing when the query fails', async () => {
    vi.mocked(getEvents).mockRejectedValue(new Error('offline'));
    await expect(getObjectLabels('p1')).resolves.toEqual([]);
  });

  it('returns nothing when no event carries a detection', async () => {
    vi.mocked(getEvents).mockResolvedValue(page(['Motion: All', '']) as never);
    await expect(getObjectLabels('p1')).resolves.toEqual([]);
  });
});

describe('buildObjectLabelLine', () => {
  it('names the labels and tells the model to map a category onto them', () => {
    const line = buildObjectLabelLine(['car', 'person', 'truck']);
    expect(line).toContain('car, person, truck');
    expect(line).toContain('["car","truck"]');
    expect(line).toContain('never the user');
  });

  // The list is a sample of recent events, not the detector's full vocabulary.
  // A model told otherwise would answer "no such thing" for a rare label.
  it('says the list may be incomplete', () => {
    expect(buildObjectLabelLine(['car'])).toContain('Other labels may exist');
  });

  it('says nothing at all when the vocabulary is unknown', () => {
    expect(buildObjectLabelLine([])).toBe('');
  });
});
