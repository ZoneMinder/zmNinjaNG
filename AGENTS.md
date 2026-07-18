# Development Guidelines

Read this file before work. Read each listed playbook before work in that area.

| Work | Read first |
|---|---|
| Tests, UI, navigation, or platform checks | `docs/agent-playbooks/testing.md` |
| Developer or user documentation | `docs/agent-playbooks/documentation.md` |
| Capacitor, TLS, Electron, downloads, or native paths | `docs/agent-playbooks/native.md` |
| Assistant tools, WebLLM, or ZoneMinder schemas | `docs/agent-playbooks/data-integrity.md` |

## Core rules

1. Write plain, factual prose. No marketing claims, AI filler, recap sections, or em-dashes. Teach React where developer docs first rely on it.
2. Create or use a GitHub issue before feature or bug work. User instruction to use an existing issue overrides creating one.
3. Test first. Before commit run `npm test`, `npx tsc -b`, `npm run build`, and relevant feature e2e. Never commit after a failed or unrun gate.
4. Update user docs for changed behavior. Update developer docs and affected call flows for new APIs, components, hooks, utilities, or documented paths.
5. Never hardcode user text. Update en, de, es, fr, and zh.
6. UI changes need an outcome-based e2e test, platform tags, and `data-testid` on new interactive elements.
7. Settings are profile-scoped through `getProfileSettings` and `updateProfileSettings`.
8. Polling uses `useBandwidthSettings()` or `getBandwidthSettings()`. Never hardcode refresh intervals.
9. Log with a `log.*` helper and explicit `LogLevel`. Never `console.*`.
10. Use `lib/http.ts` helpers. Never raw `fetch()` or `axios`.
11. Flex text uses `min-w-0`, `truncate`, and a `title`; multi-line text uses `line-clamp-N`.
12. Keep files near 400 LOC. No dead code, commented-out replacements, or speculative abstractions.
13. Capacitor plugins import dynamically behind a platform check and have a test mock.
14. Mobile downloads use Capacitor HTTP base64 directly, never Blob conversion.
15. Do not commit plan files.
16. Finish requested behavior. For materially different UX options, get approval before choosing.
17. Never merge `main` without user approval.
18. One logical change per conventional commit. Issue work uses `refs #<id>`; use `fixes` only after user confirms.
19. Read failures. Fix cause. Do not blindly retry.
20. Labels must fit 320px. Prefer concise translations.
21. User-facing date/time uses `useDateTimeFormat()` or `formatAppDate*`, never literal date-fns patterns.
22. Add a concise general rule only when a new recurring failure warrants it. Keep one-off facts near code.
23. Semantic constants belong in `lib/zmninja-ng-constants.ts` or `lib/zm-constants.ts`.
24. GitHub comments identify Claude assisting @pliablepixels, with that exact attribution line. Commits do not.
25. Do not commit incidental native build-number bumps. Commit intended bumps alone as `chore:`.
26. React Query keys and invalidations use `query-keys.ts`; profile keys use `asProfileId()`.
27. Zustand subscriptions select all reactive fields, use `useShallow` when needed, and never mutate `getState()` objects.
28. Services do not statically import stores. Use gates. Keep `npx madge --circular` at zero.
29. Query errors use `ErrorBanner` plus `resolveQueryError(err, t)`; loading uses shared query-state skeletons.
30. New `lib/` modules use their domain folder. No one-file folders.
31. `lint:a11y` is blocking. Edited files add no general-lint violations.
32. For issue work, land via an issue-linked PR. If instructed to push directly to default branch, push directly and verify issue timeline.
33. Only one `npm run test:e2e` per working tree.
34. Verification runs direct commands, not output-summarizing wrappers.
35. `AGENTS.md` owns process rules. Developer docs link rule numbers rather than copying them.
36. When asked for a test build, use a matching existing GitHub workflow. Do not add a workflow unless none fits.

## Working directory

Run npm commands from `app/`. Run root `npm install` once before `app/` install so hooks exist.

## Verification

```
npm test
npx tsc -b
npm run build
npm run test:e2e -- <feature>.feature
```

Last command applies to UI, navigation, and workflow changes. State completed checks in handoff.
