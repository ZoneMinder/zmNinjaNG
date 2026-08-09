# Native playbook

Read before Capacitor, TLS, Electron, downloads, or native-path work.

- Native or CI-untestable changes need real-device verification before merge. State it in handoff or PR.
- Prefer least-breaking hardening. If a fix necessarily breaks an existing native behavior, document accepted risk.
- Plugin import style, TLS trust, and download paths: Native contract in `AGENTS.project.md`. Additionally, plugins match the `@capacitor/core` major version and get mocks in `tests/setup.ts`.
- Use `hooks/useCapacitorListener` for plugin listeners.
- Native logging (`Log.*`, `NSLog`, `CAPLog.print`) never passes through the Logging contract's sanitizer, which lives on the JS side. Nothing gates it, so it is on you: never log a URL handed across the bridge, and never log a media or HTTP error object raw. Stream and event URLs carry the access token in the query, media3 quotes the failing URL in its message and again in the cause chain, and logcat is readable by anyone with adb (refs #307). Log an error code and a scrubbed message instead.
- `npm run android:sync`, `npm run ios:sync`, and commands that invoke them bump native versions. Revert incidental bumps before commit. Intended bumps are standalone `chore:` commits.
- Never declare an Android permission ahead of the targetSdk that enforces it. `ACCESS_LOCAL_NETWORK` was declared while targeting API 36, where local network access is implicitly granted through `INTERNET`. The declaration replaced that grant on Android 17 devices with a default-denied `NEARBY_DEVICES` toggle nothing requested, so every LAN server timed out (#350). Declaration and runtime request land together with the bump; the gate is in `src/tests/agents-contracts.test.ts`.
- Never resolve a promise with a `registerPlugin` proxy: the proxy intercepts every property access as a native method call, so `.then` on it is probed as an unimplemented method and the awaiter hangs forever. An async helper resolves with the plugin module's namespace and callers destructure the plugin from it after the await.

