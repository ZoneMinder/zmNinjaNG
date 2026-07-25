Introduction to zmNinjaNg Development
=====================================

zmNinjaNg is a ZoneMinder client written in React and TypeScript. One codebase
ships to iOS and Android (through Capacitor), to the desktop (through
Electron), and to the browser.

What is zmNinjaNg?
------------------

ZoneMinder is an open-source video surveillance system. It records from cameras
and stores motion-triggered recordings, and it exposes both an HTTP API and a
streaming daemon called ZMS.

zmNinjaNg is a client for that server. It views live camera streams, browses
recorded footage, and receives push notifications when new recordings arrive.
Everything it displays comes from a ZoneMinder server that the user configures.

Three nouns recur through the whole guide, and they are ZoneMinder's, not ours:

- **Monitor**: one camera.
- **Event**: one motion-triggered recording on a monitor.
- **Profile**: one configured ZoneMinder server, with its URL, credentials, and
  settings. Settings are scoped to a profile, never global.

Who This Guide Is For
---------------------

Programmers who are comfortable in some language but have not written React.
The guide explains React fundamentals as they come up. This was primarily to
educate me as I did not have React experience and only limited TypeScript
experience. Where the guide slows down to explain a hook or a rendering rule,
that is why.

Where to Start
--------------

**New to React?** Read :doc:`02-react-fundamentals`, then
:doc:`03-state-management-zustand`. Together they cover how React decides to
re-render and how this app holds state across components.

**Returning to the codebase, or out of touch?** Read :doc:`call-flows`. It
traces real user actions through the actual code, step by step, and links into
the reference chapter for each layer it passes through.

**Adding a feature?** :doc:`09-contributing` has the workflow.
:doc:`06-testing-strategy` has what you must test before committing.

**Debugging?** Find the flow your bug sits on in :doc:`call-flows`, then read
the chapter covering the layer where it breaks.

Code examples come from the codebase. File paths are written relative to
``app/``, so ``src/api/auth.ts`` means ``app/src/api/auth.ts``.

A TypeScript Primer
-------------------

The rest of the guide assumes the TypeScript below. If you already write
TypeScript, skip this section.

``interface``: the shape of an object
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: typescript

   // src/api/auth.ts
   export interface LoginCredentials {
     user: string;
     pass: string;
   }

An ``interface`` names the shape of an object. It is erased before the code
runs: it constrains what the compiler accepts and emits no JavaScript. Nothing
checks at runtime that a value really has these fields, which is why responses
crossing the network boundary are validated with zod schemas instead (see
:doc:`07-api-and-data-fetching`).

Generics: a type the caller fills in
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: typescript

   // src/lib/http.ts
   export async function httpGet<T = unknown>(
     url: string,
     options?: Omit<HttpOptions, 'method' | 'body'>
   ): Promise<HttpResponse<T>>

``<T>`` is a type parameter, a hole the caller fills. ``ZmsEventPlayer.tsx``
fills it with an inline shape:

.. code-block:: typescript

   // src/components/events/ZmsEventPlayer.tsx
   const resp = await httpGet<{ status?: { progress?: number; duration?: number } }>(url, { signal });

so ``resp.data.status?.progress`` typechecks without a cast. The default of
``unknown`` means a caller who supplies no type argument gets a value it cannot
use until it narrows the type.

``Omit<T, K>``: a type minus some keys
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: typescript

   // src/stores/profile.ts
   addProfile: (profile: Omit<Profile, 'id' | 'createdAt'>) => Promise<string>;

``Omit<T, K>`` is ``T`` with the keys ``K`` removed. The caller of
``addProfile`` supplies every field of a ``Profile`` except ``id`` and
``createdAt``, because the store mints those. Adding a field to ``Profile``
automatically requires it here, which a hand-written second interface would not.

``Record<K, V>``: an object used as a map
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: typescript

   // src/stores/monitors.ts, trimmed to one member
   interface MonitorStore {
       connKeys: Record<string, number>;
   }

``Record<K, V>`` types an object whose keys are ``K`` and whose values are
``V``. Here it maps a monitor id to that monitor's ZMS connection key.

``?.`` and ``??``: reaching into values that might be absent
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: typescript

   // src/lib/time.ts
   const timeZone = currentProfile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

``a?.b`` evaluates to ``undefined`` when ``a`` is ``null`` or ``undefined``,
rather than throwing. The related ``??`` operator returns its right side only
when the left side is ``null`` or ``undefined``, where ``||`` also falls
through on ``''`` and ``0``. The difference matters: with ``??`` an empty-string
timezone would be kept, and with ``||`` it falls back to the device timezone.

Getting Help
------------

- Read ``AGENTS.md`` at the repository root for the development rules. Every
  rule there carries a tiered ID (P3, C6, M1), and the rest of this guide cites
  those IDs rather than restating them. :doc:`14-agent-development-model`
  explains the whole system.
- Read ``app/tests/README.md`` for how the test suites are laid out and run.
- Look at existing code for patterns before inventing one.
