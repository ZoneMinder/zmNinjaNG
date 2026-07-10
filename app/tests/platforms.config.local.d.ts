/**
 * Type surface for the optional, gitignored `platforms.config.local.ts`.
 *
 * `platforms.config.ts` imports that file to let a developer override simulator
 * names and ports for their machine, and falls back to the defaults when it is
 * absent. Without this declaration the import is a compile error on every
 * checkout that does not have the local file, which is all of them by default.
 */
import type { PlatformTestConfig } from './platforms.config.defaults';

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

declare const overrides: DeepPartial<PlatformTestConfig>;
export default overrides;
