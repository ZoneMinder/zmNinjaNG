# Native playbook

Read before Capacitor, TLS, Electron, downloads, or native-path work.

- Native or CI-untestable changes need real-device verification before merge. State it in handoff or PR.
- Prefer least-breaking hardening. If a fix necessarily breaks an existing native behavior, document accepted risk.
- Plugin import style, TLS trust, and download paths: Native contract in `AGENTS.project.md`. Additionally, plugins match the `@capacitor/core` major version and get mocks in `tests/setup.ts`.
- Use `hooks/useCapacitorListener` for plugin listeners.
- `npm run android:sync`, `npm run ios:sync`, and commands that invoke them bump native versions. Revert incidental bumps before commit. Intended bumps are standalone `chore:` commits.
- Never resolve a promise with a `registerPlugin` proxy: the proxy intercepts every property access as a native method call, so `.then` on it is probed as an unimplemented method and the awaiter hangs forever. An async helper resolves with the plugin module's namespace and callers destructure the plugin from it after the await.

