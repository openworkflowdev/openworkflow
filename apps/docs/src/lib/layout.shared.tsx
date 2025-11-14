import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { i18n, type Locale } from './i18n';
import { getTranslation } from './translations';

export function baseOptions(locale?: Locale): BaseLayoutProps {
  const currentLocale = locale || i18n.defaultLanguage;
  const t = getTranslation(currentLocale);

  return {
    i18n,
    nav: {
      title: t.nav.title,
      url: `/${currentLocale}`,
    },
   githubUrl: 'https://github.com/openworkflowdev/openworkflow',
  };
}
