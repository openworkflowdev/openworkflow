import { createFileRoute, redirect } from '@tanstack/react-router';
import { i18n } from '@/lib/i18n';

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({
      to: '/$lang',
      params: { lang: i18n.defaultLanguage },
    });
  },
});
