Building for Mobile & Desktop
=============================

zmNinjaNg can be built as a native mobile app (Android, iOS) or a desktop app
(macOS, Windows, Linux). The same source code is used across all platforms.

Prerequisites
-------------

- Node.js ^20.19.0 or >=22.12.0 and npm
- For Android: Android Studio, JDK 17+
- For iOS: Xcode, macOS, Apple Developer account

Web Build
---------

The simplest target. Produces static files you can host anywhere.

.. code-block:: bash

   cd app
   npm install
   npm run build    # Output: dist/
   npm run preview  # Preview locally

Deploy the ``dist/`` folder to Netlify, Vercel, GitHub Pages, AWS S3, or
any static host.

Desktop Build (Electron)
------------------------

Produces a native desktop app via Electron.

.. code-block:: bash

   cd app
   npm install
   npm run electron:dev     # Development with HMR
   npm run electron:build   # Production build -> desktop_release_builds/electron/

macOS Code Signing: Avoiding Keychain Prompts
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

When running ``npm run electron:build`` on macOS, you may be prompted for your
keychain password multiple times (once per binary that needs signing). To
avoid this:

1. Open **Keychain Access**
2. Under **My Certificates**, find your signing certificate and expand it to
   reveal the private key
3. Right-click the private key and select **Get Info**
4. Go to the **Access Control** tab
5. Select **Allow all applications to access this item**
6. Click **Save Changes** and enter your keychain password when prompted

This is a one-time change. You will not be prompted again for subsequent builds.

Mobile Builds
-------------

.. toctree::
   :maxdepth: 2

   ANDROID
   IOS

Versioning
----------

Two numbers identify a build, set by
`sync-version.js <https://github.com/ZoneMinder/zmNinjaNg/blob/main/scripts/sync-version.js>`_
(run by ``npm run android:sync`` / ``npm run ios:sync`` and by the release
script):

- **Marketing version**, from ``package.json`` ``version`` (e.g. ``1.1.14``).
  Written to Android ``versionName`` and iOS ``MARKETING_VERSION``
  (``CFBundleShortVersionString``). This is the version shown in the store
  listing and the app sidebar. Bump it on a prod release.
- **Build number**, the git commit count (``git rev-list --count HEAD``).
  Written to Android ``versionCode`` and iOS ``CURRENT_PROJECT_VERSION``
  (``CFBundleVersion``). The stores require this to strictly increase per
  upload. It is the same value the app sidebar shows in parentheses, so
  ``v1.1.14 (1512)`` in the app matches ``versionCode 1512`` in the Play
  Console and ``CFBundleVersion 1512`` in App Store Connect.

The git commit count increases on every commit and stays monotonic as long as
release builds come from ``main`` without rewriting published history. The
Android ``versionCode`` is a signed 32-bit integer capped at 2,100,000,000 by
Google Play, which the commit count stays far below.

The generated ``versionCode`` / ``CURRENT_PROJECT_VERSION`` values in
``app/android/app/build.gradle`` and the Xcode project are regenerated and
committed at release time by ``make_release.sh``; they are not committed on
every change.

Automated Releases
------------------

zmNinjaNg uses GitHub Actions to build release binaries automatically. See
`make_release.sh <https://github.com/ZoneMinder/zmNinjaNg/blob/main/scripts/make_release.sh>`_
for the release workflow.

To enable automated builds on your fork:

1. Go to **Settings > Actions > General** in your GitHub repository
2. Under **Workflow permissions**, select **Read and write permissions**
3. Click **Save**

Pushing a version tag triggers builds for Android, Linux (amd64 and arm64), macOS, and Windows. iOS is not built in CI, use the steps in :doc:`IOS` to build and submit it locally from a Mac with Xcode.
