Contributing to zmNinjaNg
=========================

The process rules for this project live in one place: ``AGENTS.md`` at the
repo root. They are numbered, and this chapter cites them by number rather
than repeating them. A restated rule drifts the moment the original changes,
and this chapter is the proof: it copied out P3's verification commands,
and went on printing a typecheck flag the rule had already replaced, in four
separate places. When a rule number below sounds relevant, read the rule.

Before You Start
----------------

1. **Read the documentation**

   - The numbered chapters of this guide (1 through 13).
   - :doc:`call-flows`. Start here if you are new. It traces real user
     actions (logging in, arming a monitor, opening a live stream) from the
     button press through to the ZoneMinder API and back, naming the exact
     file and symbol at each hop. It is the fastest way to build a map of the
     codebase, and the chapters make more sense once you have one.
   - ``AGENTS.md`` at the repo root. The numbered rules are binding on
     human and agent contributions alike.
   - ``app/tests/README.md`` for the test harness.

2. **Set up your development environment**

   .. code:: bash

      git clone https://github.com/ZoneMinder/zmNinjaNg.git
      cd zmNinjaNg

      # One-time: install the repo-root tooling (husky, lint-staged) so the
      # git hooks below are wired up. `.git` lives at the repo root, so this
      # install has to run from here, not from app/.
      npm install

      cd app
      npm install

      # Set up test server credentials
      cp .env.example .env
      # Edit .env with your ZoneMinder server details

      npm run dev

   Then run the verification sequence in ``AGENTS.md`` (P3) once against a
   clean checkout. If it passes before you have changed anything, your
   toolchain is good and any later failure is yours.

3. **Understand the codebase**

   Read the architecture chapters (4 and 5), then pick one feature you can see
   in the running app and follow its trace in :doc:`call-flows` with the source
   open beside it.

Development Workflow
--------------------

1. Pick or Create an Issue
~~~~~~~~~~~~~~~~~~~~~~~~~~

P1: an issue exists before the code does. Search the tracker first; if
nothing covers your change, open one. Blank issues are disabled, so bug reports
go through the bug report template and questions go to
`Discussions <https://github.com/ZoneMinder/zmNinjaNg/discussions>`__.

For anything larger than a bug fix, agree on the approach in the issue before
writing code. P7 makes this concrete: when more than one design is viable,
present the options and get a decision rather than picking one and building it.

2. Create a Branch
~~~~~~~~~~~~~~~~~~

.. code:: bash

   git checkout main
   git pull origin main
   git checkout -b feature/your-feature-name

Branch prefixes: ``feature/``, ``fix/``, ``refactor/``, ``docs/``, ``test/``.

P1 governs how the branch gets back to ``main``: land issue-tracked work
through a pull request that references the issue, so GitHub links the commits
itself. Pushing to a scratch branch and fast-forwarding it onto ``main`` can
consume that auto-reference and leave the issue with no linked commits.

3. Write the Failing Test First
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

P2 puts the test before the implementation. Write a test that reproduces
the bug or asserts the missing behavior, watch it fail, then make it pass. A
test written after the fix proves only that the code you just wrote runs; it
does not prove it fixed anything.

Unit tests live next to their source in ``__tests__/``. UI, navigation, and
interaction changes also need a Gherkin scenario in
``app/tests/features/*.feature``. :doc:`06-testing-strategy` covers both.

4. Write the Code
~~~~~~~~~~~~~~~~~

Each rule below is stated in full in ``AGENTS.md``; the one-liners here are
signposts, not the rule.

- Localization contract: no hardcoded user-facing strings, and every locale directory under
  ``app/src/locales/`` gets the key.
- Logging contract: ``log.*`` helpers with an explicit ``LogLevel``, never ``console``.
- HTTP contract: ``httpGet`` / ``httpPost`` and friends from ``lib/http.ts``, never
  raw ``fetch``.
- C2: files stay near 400 lines, and replaced code is deleted rather than
  commented out.
- Project rules: ``data-testid="kebab-case-name"`` on every interactive element.
- Constants contract: named constants live in ``lib/zmninja-ng-constants.ts`` or
  ``lib/zm-constants.ts``, not inline.
- Server queries contract: React Query keys and invalidations come from the ``queryKeys``
  factory in ``lib/query/query-keys.ts``.
- C5: new ``lib/`` modules go in a domain subfolder.

5. Git Hooks
~~~~~~~~~~~~

``git commit`` runs two local hooks via husky; the hook scripts live in
``.husky/`` at the repo root:

- **pre-commit** does three things. It runs ``eslint`` on staged ``.ts`` and
  ``.tsx`` files through ``lint-staged`` and prints what it finds without
  blocking, because the pre-existing lint backlog (tracked in #217) in files
  you did not touch would otherwise stop every commit. It then runs the
  ``jsx-a11y`` ruleset (``app/eslint.a11y.config.js``) across the ``app/``
  tree as a hard gate: that ruleset is clean today and a new accessibility
  violation should fail here, not in review (I3). Finally it runs
  ``tsc -b`` over the whole project.
- **commit-msg** rejects a commit whose staged diff touches a native build
  number (``versionCode`` in ``app/android/app/build.gradle``, or
  ``CURRENT_PROJECT_VERSION`` in ``app/ios/App/App.xcodeproj/project.pbxproj``)
  unless the message is a ``chore:`` commit (project rules). ``npm run android:sync``
  and ``npm run ios:sync`` bump both as a side effect (via
  ``scripts/sync-version.js``; ``npm run build`` alone does not), and the guard
  (``scripts/check-native-version-bump.mjs``) keeps that bump from riding along
  in an unrelated commit. When it fires and you did not mean to bump anything:

  .. code:: bash

     git checkout -- app/android/app/build.gradle \
       app/ios/App/App.xcodeproj/project.pbxproj

The hooks are only wired up if you ran ``npm install`` at the repo root. CI
re-checks the project rules in the ``native-version-guard`` job, so a skipped root
install cannot get a stray bump past review, but it will let you waste a push
finding out.

6. Verify
~~~~~~~~~

Run the verification sequence in ``AGENTS.md`` (P3) before every commit,
and state in the commit body which steps you ran. If a step fails, read the
output and fix the cause (P4). Re-running a failing test unchanged is not
a debugging strategy.

7. Commit
~~~~~~~~~

Conventional format, one logical change per commit (P5):

::

   <type>: <description>

   [optional body]

   [optional footer]

Types: ``feat:``, ``fix:``, ``docs:``, ``test:``, ``refactor:``, ``chore:``.

.. code:: bash

   git commit -m "feat: add PTZ preset buttons to monitor detail page

   - Implemented preset selection UI
   - Added API integration for preset recall
   - Updated MonitorDetail component tests

   Tests verified: npm test, npx tsc -b, npm run build,
   npm run test:e2e -- monitor-detail.feature

   refs #123"

Vague subjects (``fixed bug``, ``wip``, ``test``) and batched subjects
(``fix login bug and add dark mode and update docs``) both get sent back. Split
the batch into one commit per change.

**Issue references.** P1 is stricter than GitHub's syntax allows. While an
issue is open for the work, every commit for it carries ``refs #<id>``. The
closing keyword ``fixes #<id>`` is reserved until the user has confirmed the
fix actually works, because a commit that says ``fixes`` closes the issue the
moment it merges, and a bug closed by assertion rather than by confirmation is
a bug that gets reopened.

.. code:: bash

   # While the work is in flight, and by default:
   git commit -m "fix: prevent duplicate profiles in list

   refs #45"

8. Push and Open a Pull Request
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code:: bash

   git push origin feature/your-feature-name

There is no pull request template in the repo. This is the body that gets a
review without a round trip:

.. code:: markdown

   ## Description

   What changed and why.

   refs #<issue-number>

   ## Changes Made

   - ...

   ## Testing

   Tests verified: npm test, npx tsc -b, npm run build,
   npm run test:e2e -- <feature>.feature

   ## Screenshots (if UI changed)

   [Attach screenshots to the PR; never commit screenshot files to the repo]

   ## Checklist

   See "Before You Ask for Review" in the contributing chapter.

9. Review and Merge
~~~~~~~~~~~~~~~~~~~

Address feedback in new commits rather than force-pushing, so the reviewer can
read the delta. Re-run the P3 sequence after every round of changes, and
update the PR description if the scope moved.

A maintainer merges. P8: nothing reaches ``main`` without the maintainer's
approval, and CI has to be green first. Only the web e2e suite runs in CI
(project rules); the iOS and Android suites are invoked by hand, so a change that
touches a native path is not done until someone has run it on a real device
(the native playbook, ``docs/agent-playbooks/native.md``).

What Reviewers Actually Check
-----------------------------

The rules are the review. These are the ones new contributors trip on most,
in the order they tend to come up:

- **Server queries contract, query keys.** An inline key array (``['monitors', profileId]``)
  compiles, fetches, and caches. It also never gets invalidated, because the
  invalidator elsewhere uses the factory key and the two arrays are not equal.
  Use ``queryKeys`` from ``lib/query/query-keys.ts``, with a ``ProfileId``
  minted through ``asProfileId()`` (``api/types.ts``).
- **Stores contract, Zustand selectors.** Subscribe to fields, not to the whole store.
  Zustand re-renders a component when the value its selector returns changes,
  so a selector returning the whole store re-renders on every unrelated write.
  The failure mode that gets missed in review is subtler: if you narrow a
  selector down to only the actions a component calls, it compiles, renders
  once, and then never re-renders when the data changes. Keep every field the
  component reads inside the selector, and use ``useShallow`` for object
  returns (see ``components/monitors/MontageMonitor.tsx``).
- **Query UI states contract, error and loading UI.** Error walls use ``ErrorBanner`` with
  ``resolveQueryError(err, t)``, which folds a 401 into the localized
  reauthentication prompt. Loading states use the shared skeletons in
  ``components/ui/query-state.tsx``. A hand-rolled error div renders the raw
  ``error.message`` in English and tells a logged-out user nothing useful.
- **Localization contract, all five locales.** Covered below; it has a specific failure mode
  worth understanding.
- **Project rules, ``data-testid``.** Without it the e2e step definitions have
  nothing stable to select, and the next contributor writes a selector against
  a CSS class you are about to rename.
- **Testing playbook, e2e guards.** A conditional step must derive its guard from the
  API or the fixture data, never from whether the element under test is
  visible. A guard keyed on the element under test turns that element's
  regression into a green pass. ``tests/steps/ptz.steps.ts`` derives its guard
  the right way: it asks the ZoneMinder API whether the monitor is controllable
  (``isMonitorControllable``) instead of peeking at the DOM.
- **Project rules, native build numbers.** ``npm run android:sync`` / ``ios:sync``
  bump ``versionCode`` and ``CURRENT_PROJECT_VERSION`` as a side effect
  (``npm run build`` alone does not). Revert them before committing anything
  that is not a version-bump ``chore:``.
- **Project rules, docs teach.** A new hook or component is not documented by an
  entry listing its location and props. Say what user-visible behavior it
  serves, and if it changes a path that :doc:`call-flows` traces, update the
  trace.

Internationalization
--------------------

The Localization contract covers this. Two things about how it fails are worth knowing before you
hit them.

**Hardcoded strings are invisible to the linter.** Nothing in the toolchain
catches ``<Button>Delete</Button>``. Route every user-facing string through
``useTranslation``:

.. code:: tsx

   import { useTranslation } from 'react-i18next';

   function Monitors() {
     const { t } = useTranslation();
     return <EmptyState title={t('monitors.no_cameras')} />;
   }

That key is real: ``app/src/pages/Monitors.tsx:231``, defined in all five
``app/src/locales/<lang>/translation.json`` files. The snippet is simplified
from that call site, which also passes ``EmptyState``'s required ``icon`` prop.

**A missing translation does not look like a bug.** ``app/src/i18n.ts`` sets
``fallbackLng: 'en'``, so a key you added to ``en`` and forgot in ``de`` does
not render as a raw key on a German device. It renders the English string, in
the middle of a German screen, and nobody notices until a German speaker files
an issue. There is no CI check for locale-key parity. Add the key to all five
files in the same commit, or it will not get added at all.

The project rules constrain the translations themselves: button, tab, and action labels
have to stay short in every language, because they share a 320 pixel wide
screen. Prefer the single-word synonym (ES "Ajustes", not "Configuración").

Before You Ask for Review
-------------------------

Each item names the rule that owns it. Items without a rule number are
codebase-specific traps with no rule to cite.

- ☐ P1: issue exists and is referenced
- ☐ P2/P3: failing test written first; verification sequence run and passing
- ☐ Localization contract: all five locale files updated
- ☐ Logging contract: ``log.*`` helpers, no ``console``
- ☐ HTTP contract: ``lib/http.ts``, no raw ``fetch``
- ☐ C2: no dead code, no commented-out blocks
- ☐ Project rules: ``data-testid`` on new interactive elements
- ☐ P1: conventional subject, ``refs #<id>`` not ``fixes #<id>``
- ☐ P5: one logical change per commit
- ☐ Date and time contract: user-visible dates via ``useDateTimeFormat`` or ``formatApp*``
- ☐ Constants contract: named constants centralized
- ☐ Project rules: native build-number bumps reverted
- ☐ Server queries contract: query keys from the factory
- ☐ Stores contract: selective, immutable store subscriptions
- ☐ Query UI states contract: ``ErrorBanner`` and shared skeletons
- ☐ Testing playbook: e2e guards derive from API or fixture data
- ☐ P10: developer docs updated where behavior changed
- ☐ No secrets, tokens, or passwords in log payloads
- ☐ ``opacity-0`` overlays over interactive content carry
  ``pointer-events-none`` (they still swallow taps on iOS)
- ☐ Every ``useEffect`` that starts something stops it in its cleanup

Worked Examples
---------------

Adding a Feature
~~~~~~~~~~~~~~~~

Adding a "favorites" star to monitors, as it would actually be sequenced:

.. code:: bash

   git checkout -b feature/monitor-favorites

   # 1. Failing tests first (P2):
   #    - unit: favorites actions on the settings store
   #    - e2e:  scenario in tests/features/monitors.feature
   #
   # 2. Implement:
   #    - add the favorites array to ProfileSettings (src/stores/settings.ts)
   #    - read and write it through getProfileSettings/updateProfileSettings
   #      (Settings contract: profile-scoped, never a global singleton)
   #    - add the star control to MonitorCard
   #      (src/components/monitors/MonitorCard.tsx), with a data-testid
   #    - add the i18n keys to all five locale files
   #
   # 3. Verify: the P3 sequence, plus
   npm run test:e2e -- monitors.feature

   git commit -m "feat: add monitor favorites

   Starred monitors sort to the top of the monitors list. The favorites
   array is stored per profile, so two servers keep separate stars.

   Tests verified: npm test, npx tsc -b, npm run build,
   npm run test:e2e -- monitors.feature

   refs #78"

   git push origin feature/monitor-favorites
   # then open a PR referencing #78 (P1)

Fixing a Bug
~~~~~~~~~~~~

.. code:: bash

   git checkout -b fix/stream-reconnect-loop

   # 1. Reproduce it in a test and watch it fail.
   # 2. Fix the cause, not the symptom.
   # 3. Verify: the P3 sequence.

   git commit -m "fix: prevent infinite connkey regeneration loop

   ResizeObserver fired on every layout pass, which recreated the
   regenerateConnection callback, which regenerated the connection key,
   which resized the stream. Held the profile and the regeneration
   callback in refs so neither identity changes per render.

   Tests verified: npm test, npx tsc -b, npm run build,
   npm run test:e2e -- monitors.feature

   refs #92"

The commit says ``refs #92``, not ``fixes #92``. The maintainer confirms the
fix on a device, and only then does a commit or the PR close the issue
(P1). Callback identity and the render loop it feeds are explained in
:doc:`02-react-fundamentals`; the streaming path itself is traced in
:doc:`call-flows`.

Updating Documentation
~~~~~~~~~~~~~~~~~~~~~~

.. code:: bash

   git checkout -b docs/improve-testing-guide

   # Edit docs/developer-guide/06-testing-strategy.rst

   git commit -m "docs: add pagination testing examples to testing strategy

   refs #<id>"

The project rules set the bar: the developer guide is written for a competent programmer
with no React experience, so a doc change that introduces a React mechanism has
to explain it at the point of use or link the section of
:doc:`02-react-fundamentals` that does. P10 decides where the change lands:
if it alters a path :doc:`call-flows` traces, the trace is the primary edit and
the chapter entry is secondary. Every code example must grep-hit in
``app/src/``.

Style
-----

React and TypeScript conventions (component shape, prop destructuring,
avoiding ``any``) are taught in :doc:`02-react-fundamentals` alongside the
mechanisms they exist to serve. This chapter does not repeat them.

What is specific to this repo:

- Components are ``PascalCase.tsx``, hooks are ``useCamelCase.ts``, utilities
  are ``camelCase.ts``, and a test file takes the name of its source
  (``MonitorCard.test.tsx``).
- Test IDs are kebab-case (``data-testid="monitor-card-star"``), which is a
  different convention from everything else on purpose: it makes them
  greppable and marks them as test surface rather than app code.
- Constants are ``UPPER_SNAKE_CASE`` and live in
  ``lib/zmninja-ng-constants.ts`` (app-level) or ``lib/zm-constants.ts``
  (ZoneMinder protocol-level), per the Constants contract.
- Comments explain why, not what. The line above already says what.

Mobile Development
------------------

zmNinjaNg is a cross-platform app built with
`Capacitor <https://capacitorjs.com/>`__.

Prerequisites
~~~~~~~~~~~~~

- **Node.js**: 22+ (required by Capacitor 8)
- **Android Studio**: Otter (2025.2.1)+ with Android SDK 36, for Android
  development (installs the SDK/JDK)
- **Xcode**: 26+ for iOS development (macOS only). The iOS project uses Swift
  Package Manager, not CocoaPods: packages resolve on open, no ``pod install``.

Running on Device/Emulator
~~~~~~~~~~~~~~~~~~~~~~~~~~

The project includes helper scripts in ``package.json`` to streamline
the mobile workflow.

**Android:**

.. code:: bash

   # Sync web assets to Android project and open Android Studio
   npm run android

   # Just sync (if you already have Android Studio open)
   npm run android:sync

   # View logs from connected Android device
   npm run android:logs

**iOS:**

.. code:: bash

   # Sync web assets to iOS project and open Xcode
   npm run ios

   # Just sync
   npm run ios:sync

Workflow
~~~~~~~~

1. Make changes to the web code (``src/``).
2. Run ``npm run build`` to compile the web assets.
3. Run ``npm run android:sync`` or ``npm run ios:sync`` to copy the
   built assets to the native projects.
4. Run/Debug via Android Studio or Xcode.

Note that step 3 bumps the native build numbers (the ``sync`` scripts run
``scripts/sync-version.js`` first; step 2 alone writes nothing native). The project rules
apply: revert the bump before committing.

.. tip::

   **Live Reload**: for faster development you can configure Capacitor to load
   the dev server URL instead of the built bundle. Edit
   ``capacitor.config.ts``:

   .. code:: ts

      server: {
        url: 'http://YOUR_LOCAL_IP:5173',
        cleartext: true
      }

   Remove this before building for release.

Getting Help
------------

- **Questions about the codebase**: open a
  `GitHub discussion <https://github.com/ZoneMinder/zmNinjaNg/discussions>`__.
  Blank issues are disabled in the web UI, which routes questions to
  Discussions.
- **Bug reports**: open a GitHub issue using the bug report template.
- **Feature requests**: there is no feature-request template yet; open an issue
  via ``gh issue create --label enhancement`` (the web UI only offers the bug
  template).
- **Security issues**: contact the maintainers privately. Do not open a public
  issue and do not describe the vulnerability in a discussion. The repository
  has no ``SECURITY.md`` yet.

There is no service-level agreement on responses. This is a project maintained
in spare time.

License
-------

The project is licensed under the Apache License 2.0 (see ``LICENSE`` at the
repo root). By contributing, you agree that your contributions are licensed
under the same terms.

Recognition
-----------

There is no ``CONTRIBUTORS.md``. Contributions are recorded in the git commit
history, which is the authoritative record, and features and fixes are called
out by name in ``CHANGELOG.md`` and in the GitHub release notes.
