---
description: How to add a new language to the application
---

# Adding a New Language

To add a new language (e.g., Italian `it`) to the application, follow these steps:

## 1. Create the Translation File

Create a new directory for the language code in `app/src/locales/` and copy the English translation file as a base.

```bash
mkdir -p app/src/locales/it
cp app/src/locales/en/translation.json app/src/locales/it/translation.json
```

## 2. Translate the Content

Open `app/src/locales/it/translation.json` and translate ALL values to the new language. **Do not change any keys**, only translate the values.

**Important:** Make sure to update the language name entry itself:
```json
{
  "languages": {
    "en": "English",
    "es": "Español",
    "fr": "Français",
    "de": "Deutsch",
    "zh": "中文",
    "it": "Italiano"  // Add this for the new language
  },
  ...
}
```

## 3. Add Language Names to ALL Existing Translation Files

Add the new language's name to the `languages` section in **every** existing translation file:

- `app/src/locales/en/translation.json`
- `app/src/locales/de/translation.json`
- `app/src/locales/es/translation.json`
- `app/src/locales/fr/translation.json`
- `app/src/locales/zh/translation.json`

Add this line to the `languages` section in each:
```json
"it": "Italiano"
```

## 4. Update i18n Configuration

Open `app/src/i18n.ts` and add the new language:

**Import the translation file** (around line 6):
```typescript
import itTranslation from './locales/it/translation.json';
```

**Add to resources object** (around line 26):
```typescript
resources: {
  en: { translation: enTranslation },
  de: { translation: deTranslation },
  es: { translation: esTranslation },
  fr: { translation: frTranslation },
  zh: { translation: zhTranslation },
  it: { translation: itTranslation },  // Add this line
},
```

## 5. Update the Settings UI

Open `app/src/components/settings/LanguageSettings.tsx` and add a new `SelectItem` for the new language (around line 36):

```tsx
<SelectContent>
  <SelectItem value="en" data-testid="settings-language-option-en">{t('languages.en')}</SelectItem>
  <SelectItem value="es" data-testid="settings-language-option-es">{t('languages.es')}</SelectItem>
  <SelectItem value="fr" data-testid="settings-language-option-fr">{t('languages.fr')}</SelectItem>
  <SelectItem value="de" data-testid="settings-language-option-de">{t('languages.de')}</SelectItem>
  <SelectItem value="zh" data-testid="settings-language-option-zh">{t('languages.zh')}</SelectItem>
  <SelectItem value="it" data-testid="settings-language-option-it">{t('languages.it')}</SelectItem> {/* Add this line */}
</SelectContent>
```

## 6. Verify

1. Build the application: `npm run build`
2. Start the application: `npm run dev`
3. Go to Settings → Language Settings
4. Select the new language from the dropdown
5. Verify that the entire UI updates correctly with the new translations

## Summary Checklist

When adding a new language, you must modify these files:

- [ ] Create `app/src/locales/{lang}/translation.json`
- [ ] Translate all values in the new translation file
- [ ] Add language name to `languages` section in ALL existing translation files (en, de, es, fr, zh)
- [ ] Update `app/src/i18n.ts` - add import and resources entry
- [ ] Update `app/src/components/settings/LanguageSettings.tsx` - add SelectItem
- [ ] Test the new language in the application
