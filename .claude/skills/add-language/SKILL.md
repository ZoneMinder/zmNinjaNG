---
name: add-language
description: Use when adding a new interface language (locale) to the app, or when asked to translate the UI into another language. Covers the translation file, the two language pickers, the i18n resources, the key-parity test, and the docs and rules that hardcode the locale list.
---

# Adding a new interface language

The app bundles translations at build time. Adding a locale means touching five
code locations plus two prose locations. Miss any one and the failure is silent:
i18next falls back to English mid-screen, or the new locale ships with no
key-parity coverage.

Run all npm commands from `app/`.

Below, `{code}` is the ISO code (`it`) and `{Name}` is the language's own name
for itself (`Italiano`).

## 1. Create the translation file

```bash
mkdir -p app/src/locales/{code}
cp app/src/locales/en/translation.json app/src/locales/{code}/translation.json
```

## 2. Translate the values

Translate every value in `app/src/locales/{code}/translation.json`. Do not
change, add, or drop keys. The key-parity test in step 5 fails if the shape
drifts from `en`.

Labels must fit 320px (`AGENTS.md` rule 20), so prefer the concise translation
where two options exist.

## 3. Add the language name to every translation file

The `languages` section of each locale lists all languages, so the picker reads
correctly whatever language the UI is currently in. Add `"{code}": "{Name}"` to
the `languages` section of every `translation.json` under `app/src/locales/`,
the new one included. List them first rather than working from memory:

```bash
ls app/src/locales
```

Use the same string `{Name}` in all of them. Language names are not translated.

## 4. Register the locale in i18n

In `app/src/i18n.ts`, add the import alongside the others and the entry in
`resources`:

```typescript
import {code}Translation from './locales/{code}/translation.json';
```

```typescript
resources: {
  // ...
  {code}: { translation: {code}Translation },
},
```

## 5. Add the locale to the key-parity test

`app/src/locales/__tests__/translation-keys.test.ts` imports each locale and
lists it in an `it.each` table. A locale absent from that table is never
checked, and the test still passes, so this step is easy to skip and expensive
to skip. Add the import and the `['{code}', {code}]` row.

## 6. Update both language pickers

There are two, and they carry separate hardcoded lists:

- `app/src/components/settings/AppearanceSection.tsx` — Settings → Appearance.
  Add a `SelectItem`:

  ```tsx
  <SelectItem value="{code}" data-testid="settings-language-option-{code}">{t('languages.{code}')}</SelectItem>
  ```

- `app/src/components/layout/LanguageSwitcher.tsx` — the globe dropdown in the
  sidebar. Add to the `languages` array:

  ```tsx
  { code: '{code}', label: t('languages.{code}') },
  ```

Updating only the first is the common miss: the language works in Settings and
is absent from the sidebar.

## 7. Update the user doc

`docs/user-guide/settings.md`, Appearance table, Language row, names the
available languages in English. Add the new one.

## Nothing to do for dates or the assistant

Both already take the active locale code as data, so neither needs a per-locale
entry:

- `app/src/lib/relative-time.ts` passes the code straight to
  `Intl.RelativeTimeFormat`.
- `app/src/lib/assistant/system-prompt.ts` interpolates the locale into the
  prompt and asks the model to answer in the user's language.

## Verify

```bash
npm test
npx tsc -b
npm run build
npm run test:e2e -- settings.feature
```

`settings.feature` has a language-change scenario, so it is the relevant e2e
run for this change.

Then check the UI by hand: Settings → Appearance → Language, and the sidebar
globe dropdown. Both should list the new language, and selecting it should
change the visible text.

## Checklist

- [ ] `app/src/locales/{code}/translation.json` created and fully translated
- [ ] `languages.{code}` added to every translation file under `app/src/locales/`
- [ ] `app/src/i18n.ts` import and `resources` entry
- [ ] `app/src/locales/__tests__/translation-keys.test.ts` import and `it.each` row
- [ ] `app/src/components/settings/AppearanceSection.tsx` `SelectItem`
- [ ] `app/src/components/layout/LanguageSwitcher.tsx` array entry
- [ ] `docs/user-guide/settings.md` Language row
- [ ] `npm test`, `npx tsc -b`, `npm run build`, `npm run test:e2e -- settings.feature`
