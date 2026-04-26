/**
 * i18n — react-i18next 초기화
 * 지원 언어: ko, en, ja, zh
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ko from './locales/ko.json';
import en from './locales/en.json';
import ja from './locales/ja.json';
import zh from './locales/zh.json';

export const SUPPORTED_LANGUAGES = ['ko', 'en', 'ja', 'zh'] as const;
export type Language = typeof SUPPORTED_LANGUAGES[number];

const STORAGE_KEY = 'pkizip_lang';

function detectInitialLanguage(): Language {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && (SUPPORTED_LANGUAGES as readonly string[]).includes(saved)) {
    return saved as Language;
  }
  // navigator.language로 자동 감지
  const nav = navigator.language?.split('-')[0]?.toLowerCase();
  if (nav && (SUPPORTED_LANGUAGES as readonly string[]).includes(nav)) {
    return nav as Language;
  }
  return 'ko';
}

i18n
  .use(initReactI18next)
  .init({
    resources: {
      ko: { translation: ko },
      en: { translation: en },
      ja: { translation: ja },
      zh: { translation: zh },
    },
    lng: detectInitialLanguage(),
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });

export function changeLanguage(lng: Language): void {
  localStorage.setItem(STORAGE_KEY, lng);
  i18n.changeLanguage(lng);
}

export function getCurrentLanguage(): Language {
  return (i18n.language as Language) ?? 'ko';
}

export default i18n;
