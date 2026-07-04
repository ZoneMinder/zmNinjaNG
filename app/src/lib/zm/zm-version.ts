/**
 * ZoneMinder version comparison utility.
 *
 * Used to detect API capability differences between ZM versions
 * (e.g., 1.38+ replaced Function with Capturing/Analysing/Recording).
 */

/**
 * Returns true if the given ZM version string is >= the target version.
 *
 * Compares major.minor.patch numerically. Missing segments default to 0.
 * Returns false for null/empty version strings.
 */
export function isZmVersionAtLeast(version: string | null, target: string): boolean {
  if (!version) return false;
  const parse = (v: string) => v.split('.').map(Number);
  const [aMaj, aMin = 0, aPat = 0] = parse(version);
  const [bMaj, bMin = 0, bPat = 0] = parse(target);
  if (aMaj !== bMaj) return aMaj > bMaj;
  if (aMin !== bMin) return aMin > bMin;
  return aPat >= bPat;
}
