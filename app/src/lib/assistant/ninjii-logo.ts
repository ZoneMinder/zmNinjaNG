/**
 * Ninjii's logo (refs #246), bundled through Vite as a module asset.
 *
 * A module import (not a hardcoded `/ninjii.png` public path) because the app
 * builds with `base: './'` for the packaged desktop builds that load over
 * `file://` (Tauri on Linux, Electron): there a root-absolute URL resolves
 * against the filesystem root and 404s, which is why the icon was blank on
 * Linux desktops. Vite rewrites this import to a relative hashed URL that
 * works on every origin, same as `assets/logo.png` in AppLayout.
 *
 * Lives here rather than in `zmninja-ng-constants.ts` (rule 23 notwithstanding)
 * because that module is also imported by node-side tooling
 * (scripts/prompt-eval.mts via system-prompt.ts), where a `.png` import does
 * not parse. Shared by the widget header, the minimized FAB, AskPanel's
 * empty-thread self-introduction, and the settings section, so the asset
 * still has one source of truth.
 */
import ninjiiLogoUrl from '../../../assets/ninjii.png';

export const NINJII_LOGO_URL = ninjiiLogoUrl;
