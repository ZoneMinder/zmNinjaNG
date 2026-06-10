/**
 * Detection categorization for timeline events.
 *
 * Holds the selected detection category, computes per-category counts,
 * and filters the event list by the selected category.
 */

import { useMemo, useState } from 'react';
import { categorizeEvent, type DetectionCategory } from './DetectionFilterTabs';
import type { TimelineEvent } from './timeline-layout';

export function useDetectionCategories(events: TimelineEvent[]) {
  const [category, setCategory] = useState<DetectionCategory>('all');

  // Compute detection category counts
  const counts = useMemo(() => {
    const result: Record<DetectionCategory, number> = {
      all: events.length,
      person: 0,
      vehicle: 0,
      animal: 0,
      other: 0,
    };
    for (const ev of events) {
      const cat = categorizeEvent(ev.notes);
      result[cat]++;
    }
    return result;
  }, [events]);

  // Filter by detection category
  const filteredEvents = useMemo(() => {
    if (category === 'all') return events;
    return events.filter((ev) => categorizeEvent(ev.notes) === category);
  }, [events, category]);

  return { category, setCategory, counts, filteredEvents };
}
