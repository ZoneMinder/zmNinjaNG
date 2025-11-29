---
description: How to add a new language to the application
---

# Adding a New Language

To add a new language (e.g., French `fr`) to the application, follow these steps:

1.  **Create the Locale Directory**
    Create a new directory for the language code in `app/public/locales/`.
    ```bash
    mkdir -p app/public/locales/fr
    ```

2.  **Create the Translation File**
    Copy the English translation file to the new directory to use as a base.
    ```bash
    cp app/public/locales/en/translation.json app/public/locales/fr/translation.json
    ```

3.  **Translate the Content**
    Open `app/public/locales/fr/translation.json` and translate the values. Do not change the keys.

4.  **Update the Settings UI**
    Add the new language option to the `Settings.tsx` file.
    
    Open `app/src/pages/Settings.tsx` and find the language `Select` component (around line 94). Add a new `SelectItem` for the new language.

    ```tsx
    <SelectContent>
      <SelectItem value="en">English</SelectItem>
      <SelectItem value="es">Español</SelectItem>
      <SelectItem value="fr">Français</SelectItem> {/* Add this line */}
    </SelectContent>
    ```

5.  **Verify**
    Start the application, go to Settings, select the new language, and verify that the UI updates correctly.
