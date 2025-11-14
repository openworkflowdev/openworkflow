import { defineI18n } from 'fumadocs-core/i18n';

export const i18n = defineI18n({
  defaultLanguage: 'en',
  languages: ['en'],
  parser: 'dir',
  // Future languages: 'es', 'zh', 'pt', etc.
});

export type Locale = (typeof i18n.languages)[number];
