import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Import translation files directly for bundling
import enTranslation from './locales/en/translation.json';
import deTranslation from './locales/de/translation.json';
import esTranslation from './locales/es/translation.json';
import frTranslation from './locales/fr/translation.json';
import zhTranslation from './locales/zh/translation.json';

i18n
  // detect user language
  // learn more: https://github.com/i18next/i18next-browser-languagedetector
  .use(LanguageDetector)
  // pass the i18n instance to react-i18next.
  .use(initReactI18next)
  // init i18next
  // for all options read: https://www.i18next.com/overview/configuration-options
  .init({
    fallbackLng: 'en',
    debug: import.meta.env.DEV,

    // Bundle translations inline - eliminates HTTP requests
    resources: {
      en: { translation: enTranslation },
      de: { translation: deTranslation },
      es: { translation: esTranslation },
      fr: { translation: frTranslation },
      zh: { translation: zhTranslation },
    },

    interpolation: {
      escapeValue: false, // not needed for react as it escapes by default
    },
  });

export default i18n;
