Developer Guide
===============

This guide teaches you how to work on the zmNinjaNg codebase. It is written for
developers who may not have React experience, explaining concepts from first
principles with real examples from the code.

**New to React?** Start with Chapter 2 (React Fundamentals), then Chapter 3 (Zustand).

**Adding a feature?** Read Chapter 9 (Contributing) for the workflow, then
Chapter 6 (Testing).

**Debugging?** Find the flow your bug sits on in **Call Flows** below, then read
the chapter for the layer where it breaks: Chapter 3 (Zustand) when state does
not update, Chapter 7 (API and Data Fetching) when server data is stale or
missing, Chapter 11 (Application Lifecycle) when the problem only appears at
startup, on resume, or after backgrounding.

**Understanding the architecture?** Chapter 5 (Component Architecture) explains
how components are organized, and Chapter 11 (Application Lifecycle) explains
the runtime flow.

**Returning to the codebase, or out of touch?** Start with **Call Flows** below.
It traces a few real user actions scene by scene through the actual code and
links into the reference chapters.

.. toctree::
   :maxdepth: 2

   01-introduction
   02-react-fundamentals
   03-state-management-zustand
   call-flows
   04-pages-and-views
   05-component-architecture
   06-testing-strategy
   07-api-and-data-fetching
   09-contributing
   10-key-libraries
   11-application-lifecycle
   12-shared-services-and-components
   13-network-endpoints
   go2rtc-integration


Quick Reference
---------------

State Types
^^^^^^^^^^^

.. list-table::
   :header-rows: 1

   * - Type
     - Where
     - Example
     - When to Use
   * - **Local**
     - ``useState``
     - Form inputs, UI toggles
     - Component-specific, temporary
   * - **Global**
     - Zustand stores
     - Current profile, settings
     - Shared across components
   * - **Server**
     - React Query
     - Monitor list, events
     - Data from ZoneMinder API

The three are not interchangeable, and picking the wrong one is the most common
structural mistake in this codebase. ``useState`` and Zustand are taught in
:doc:`02-react-fundamentals` and :doc:`03-state-management-zustand`. React
Query, the cache that holds everything fetched from a ZoneMinder server, is
also introduced in :doc:`02-react-fundamentals`; this app's use of it is in
:doc:`07-api-and-data-fetching`.

File Organization
^^^^^^^^^^^^^^^^^

::

   app/
   ├── src/
   │   ├── api/          # ZoneMinder API wrappers (thin, built on lib/http.ts)
   │   ├── assets/       # Static images imported by the bundler
   │   ├── components/   # React components, grouped by feature
   │   ├── contexts/     # React context providers (PipContext)
   │   ├── hooks/        # Custom React hooks (component logic)
   │   ├── lib/          # Non-React utilities, grouped by domain
   │   ├── locales/      # i18n translations (en, de, es, fr, zh)
   │   ├── pages/        # Route-level views
   │   ├── plugins/      # Custom Capacitor plugins (pip, safe-area, ssl-trust)
   │   ├── services/     # Long-lived singletons (notifications, bootstrap)
   │   ├── stores/       # Global state (Zustand)
   │   ├── styles/       # CSS that Tailwind cannot express
   │   ├── tests/        # Vitest setup and global mocks
   │   ├── types/        # Ambient type declarations
   │   ├── App.tsx       # Providers, routes, bootstrap overlay
   │   └── main.tsx      # Entry point: createRoot + StrictMode
   └── tests/            # End-to-end tests (features, steps, helpers, native)

Unit tests do not live in ``src/tests/``. They sit in a ``__tests__/`` folder
next to the code they cover, so ``lib/security/crypto.ts`` is tested by
``lib/security/__tests__/crypto.test.ts``. ``src/tests/`` holds only the Vitest
setup file and the plugin mocks it registers.

Development Quick Start
^^^^^^^^^^^^^^^^^^^^^^^

.. code-block:: bash

   npm install      # Once, at the repo root: wires the husky git hooks
   cd app
   npm install
   npm run dev      # Start development server
   npm test         # Run unit tests
   npm run build    # Build for production

Skipping the root install silently disables every git hook; CI re-checks
what the hooks enforce, but only after you push.

Also see the `AGENTS.md <https://github.com/ZoneMinder/zmNinjaNg/blob/main/AGENTS.md>`_
file for the full development guidelines and checklists.
