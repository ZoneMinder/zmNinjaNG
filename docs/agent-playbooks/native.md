# Native playbook

Read before Capacitor, TLS, Electron, downloads, or native-path work.

- Native or CI-untestable changes need real-device verification before merge. State it in handoff or PR.
- Prefer least-breaking hardening. If a fix necessarily breaks an existing native behavior, document accepted risk.
- Capacitor plugins are dynamic imports behind platform checks, match `@capacitor/core` major version, and have mocks in `tests/setup.ts`.
- Use `hooks/useCapacitorListener` for plugin listeners.
- Mobile downloads use Capacitor HTTP base64, never Blob conversion.
- `npm run android:sync`, `npm run ios:sync`, and commands that invoke them bump native versions. Revert incidental bumps before commit. Intended bumps are standalone `chore:` commits.

