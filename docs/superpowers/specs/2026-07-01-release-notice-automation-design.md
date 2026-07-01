# Auto-drafted developer notice for minor/major releases (#211)

## Problem

The developer-notice feed (`docs/notices.json`, shown in-app as a sidebar dot)
is hand-written. There is no link between cutting a release and telling users
what changed. We want `make_release.sh` to offer, for minor/major releases, to
draft a short plain-language notice (via `claude -p`) that links to the release's
GitHub changelog, with the maintainer approving the draft before it publishes.

## Current release flow (unchanged parts)

`scripts/make_release.sh` reads the version from `app/package.json`, generates
`CHANGELOG.md` (github_changelog_generator), commits it, then creates and pushes
the `zmNinjaNg-<version>` tag. The tag push triggers `.github/workflows/create-release.yml`,
which builds release notes and creates the GitHub Release at
`https://github.com/ZoneMinder/zmNinjaNg/releases/tag/zmNinjaNg-<version>`.

The notice feed schema (`app/src/api/developer-notices.ts`): `{ id, title, body,
publishedAt, severity: info|warning|critical, link?, minAppVersion? }`. The app
sorts notices by `publishedAt` descending, so array order in the file is
cosmetic; new entries are prepended for readability.

## Decisions

- **Opt-in, gated to minor/major.** After the changelog step, `make_release.sh`
  parses `MAJOR.MINOR.PATCH`. If `PATCH == 0`, it prompts
  `Generate a developer notice for this release? [y/N]`. Patch releases never
  prompt. (Assumes features ship in minor/major releases.)
- **Claude drafts only the human text.** `claude -p` returns `{title, body}`
  (plain language, no jargon, no PR numbers, no em-dashes, no marketing words,
  body ends with a `[Full changelog](<url>)` link). The script assembles every
  structured field itself, so the AI cannot get them wrong.
- **Structured fields, script-owned:** `id = "release-<version>"`,
  `publishedAt = <now, ISO 8601>`, `severity = "info"`,
  `link = <release URL>`, `minAppVersion = <version>`.
- **`minAppVersion` = the released version.** The "what's new" only shows to
  users who actually updated to that build.
- **Maintainer approves the draft.** The script prints the assembled entry and
  asks `Add and push this notice? [y/N/e(dit)]`. `e` opens `$EDITOR` on the
  entry; `y` prepends it to `docs/notices.json`, commits, and pushes to the
  current branch (main); `N` skips. This runs before the tag step, so the notice
  commit is part of the release.
- **Graceful fallback.** If `claude` is not on `PATH`, or `-p` fails, or its
  output does not parse to `{title, body}`, the script falls back to a prefilled
  entry (title `zmNinjaNg <version>`, body containing only the changelog link)
  and routes to the `edit` path. It never aborts the release.

## Components

### `scripts/generate-release-notice.mjs` (new, Node ESM)
CLI: `node scripts/generate-release-notice.mjs <version> <tag>`. Responsibilities:
1. Compute `releaseUrl = https://github.com/ZoneMinder/zmNinjaNg/releases/tag/<tag>`.
2. Extract this version's section from `CHANGELOG.md` (the top `## [..]` block).
3. Call `claude -p "<prompt>"` piping the changelog section; parse stdout to
   `{title, body}` (tolerate a leading/trailing markdown code fence).
4. Assemble the notice entry (structured fields above).
5. Print it; prompt `[y/N/e]`; on `y`/`e` write to `docs/notices.json`
   (prepend, guard against a duplicate `id`), then `git add docs/notices.json`,
   commit `chore: add release notice for <version>`, and push.
6. Fallback behavior as above; exit 0 on skip so the release continues.

Keep the pure logic in exported functions so it is testable without spawning
`claude` or `git`:
- `parseVersionParts(version) -> {major, minor, patch}`
- `isFeatureRelease(version) -> boolean` (patch === 0)
- `extractChangelogSection(changelogText, tag) -> string`
- `parseClaudeNotice(stdout) -> {title, body} | null` (strips code fences)
- `assembleNotice({version, tag, title, body, publishedAt, releaseUrl}) -> notice`
- `prependNotice(feedArray, notice) -> feedArray` (throws if `id` already present)

Side-effecting bits (spawn `claude`, read/write files, `git`, prompts) stay in a
thin `main()` that calls the pure functions. A `--stub-claude` flag skips the
`claude` spawn and uses a fixed stub draft, and a `--dry-run` flag skips the git
commit/push, so the full path can be exercised manually.

### `scripts/make_release.sh` (modify)
After the CHANGELOG commit block and before the tagging block, add:
```bash
MAJOR=$(echo "$VERSION" | cut -d. -f1)
MINOR=$(echo "$VERSION" | cut -d. -f2)
PATCH=$(echo "$VERSION" | cut -d. -f3)
if [ "$PATCH" = "0" ]; then
  read -p "Generate a developer notice for this release? [y/N] " -n 1 -r; echo ""
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    node scripts/generate-release-notice.mjs "$VERSION" "$TAG" || \
      echo "Notice generation skipped or failed; continuing with the release."
  fi
fi
```

## Testing

**Unit - `scripts/__tests__/generate-release-notice.test.mjs`** (Vitest, run from
repo root config or a scripts-level config; confirm how the repo runs non-`app`
tests, else colocate under `app` tooling tests):
- `isFeatureRelease`: `1.2.0` true, `2.0.0` true, `1.1.16` false, `1.1.0` true.
- `extractChangelogSection`: given a two-version changelog, returns only the
  target version's block.
- `parseClaudeNotice`: parses bare JSON; parses JSON wrapped in ```json fences;
  returns null on prose/garbage.
- `assembleNotice`: sets `id=release-<v>`, `severity=info`, `minAppVersion=<v>`,
  `link=<url>`, and the passed `title`/`body`/`publishedAt`.
- `prependNotice`: prepends; throws when the `id` already exists in the feed.

**Manual**: `node scripts/generate-release-notice.mjs 9.9.0 zmNinjaNg-9.9.0 --stub-claude --dry-run`
prints an assembled notice without calling Claude or touching git; verify the
JSON shape matches the feed schema.

The `claude -p` spawn and the interactive prompts are not unit-tested.

## Docs

- Developer guide (release/tooling section, or a short new note): document that
  `make_release.sh` offers a notice on minor/major releases, that Claude drafts
  the text, and that the maintainer approves before it publishes.
- No user-guide change (this is maintainer tooling).

## Constraints

- Notice body must follow the repo's writing rules (the `claude -p` prompt
  enforces: plain, no em-dashes, no superlatives, no PR numbers). The maintainer
  approval step is the backstop.
- Do not block or slow the release on any notice failure.
- `generate-release-notice.mjs` stays small; pure logic separated from IO.

## Out of scope

- Auto-posting on patch releases.
- Generating notices from CI (`create-release.yml`); this stays local in
  `make_release.sh` so the maintainer approves the wording.
- Changing the notice feed schema, the in-app rendering, or `create-release.yml`.
