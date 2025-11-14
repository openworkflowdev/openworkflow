import type { Locale } from '../i18n';
import { en, type Translation } from './en';

const translations: Record<Locale, Translation> = {
  en,
  // Future translations:
  // es: () => import('./es').then(m => m.es),
  // zh: () => import('./zh').then(m => m.zh),
};

export function getTranslation(locale: Locale): Translation {
  return translations[locale] || translations.en;
}

export function useTranslation(locale: Locale) {
  const t = getTranslation(locale);
  return { t };
}

export type { Translation };
