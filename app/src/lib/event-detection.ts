/**
 * Parse detected object classes from a ZoneMinder event Notes field.
 * Notes look like "detected:person,car|Motion: All"; we take the part after
 * "detected:" and, for each comma-separated entry, the part before "|".
 */
export function parseDetectedObjects(notes: string | null): string[] {
  if (!notes) return [];
  const match = notes.match(/detected:(.*)/i);
  if (!match) return [];
  return match[1]
    .split(',')
    .map((s) => s.split('|')[0].trim())
    .filter(Boolean);
}
