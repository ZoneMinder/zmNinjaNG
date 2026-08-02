/**
 * The detected-object labels THIS installation actually writes (refs #246).
 *
 * Replaces a hardcoded category map (vehicle -> car/truck/...) plus English
 * plural rules. Those were guesses made in a text editor about someone else's
 * detector: an install writing `motorbike` or `delivery_van` was missed, a
 * question asked in another language went straight through them, and every new
 * label meant a code change. The app was already computing the real vocabulary
 * to build its "labels recorded in this window" hint, then ignoring it in
 * favour of the guess.
 *
 * So the labels are read from the data and given to the model, and the model
 * maps "vehicles" onto them. That works for any vocabulary, in any language,
 * with no list to maintain.
 */
import { getEvents } from '../../api/events';
import { getSession } from '../../services/sessions';
import { asProfileId } from '../../api/types';
import { parseDetectedObjects } from '../event/event-detection';
import { ASSISTANT } from '../zmninja-ng-constants';
import { log, LogLevel } from '../logger';

interface CachedLabels {
  labels: string[];
  at: number;
}

/** Per profile: two installs reached from one app must not share a vocabulary. */
const cache = new Map<string, CachedLabels>();

export function __clearObjectLabelCacheForTests(): void {
  cache.clear();
}

/**
 * Labels seen in the most recent events, newest first, cached per profile.
 *
 * A SAMPLE, not the full vocabulary: it reads one page of recent events, so a
 * label that has not occurred lately will be missing. That is why the tool
 * still reports the labels present when a filter matches nothing (see
 * `list_events`) rather than treating this list as complete. Sampling recent
 * events is the only way to learn the vocabulary at all: ZoneMinder has no
 * endpoint that enumerates what a detector can emit.
 *
 * Never throws: an install with no events yet, or a failed request, yields an
 * empty list and the prompt simply omits the line.
 */
export async function getObjectLabels(profileId: string): Promise<string[]> {
  const hit = cache.get(profileId);
  if (hit && Date.now() - hit.at < ASSISTANT.objectLabelCacheMs) return hit.labels;

  try {
    const res = await getEvents(getSession(asProfileId(profileId)).client, {
      limit: ASSISTANT.objectLabelSampleSize,
      sort: 'StartDateTime',
      direction: 'desc',
    });
    const labels = [...new Set(res.events.flatMap(({ Event: e }) => parseDetectedObjects(e.Notes)))]
      .filter((label) => label.length > 0)
      .sort();
    cache.set(profileId, { labels, at: Date.now() });
    return labels;
  } catch (error) {
    log.assistant('Could not read the detected-object vocabulary', LogLevel.WARN, {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/** The system-prompt line naming the vocabulary, or '' when it is unknown.
 *
 *  Says the list is what has been seen RECENTLY, not what exists: a model told
 *  these are the only labels would answer "no such thing" for a label that is
 *  simply out of the sample. */
export function buildObjectLabelLine(labels: string[]): string {
  if (labels.length === 0) return '';
  return (
    `Detected object labels seen recently on this installation: ${labels.join(', ')}. ` +
    'When the user names a category ("vehicles", "animals", "people"), pass EVERY label above that belongs ' +
    'to it as objectType, for example objectType ["car","truck"] for vehicles. Pass labels exactly as ' +
    'written above, never the user\'s word for them. Other labels may exist that are not in this list. ' +
    // The scoping sentence lives HERE, at the attractor: with the vocabulary
    // alone in view, "summarize april" grew objectType with every known
    // label, deterministically, silently excluding no-detection events.
    'This list is ONLY for questions that name such a thing; a summary, recap, or comparison names none, ' +
    'so it takes no objectType, ever.'
  );
}
