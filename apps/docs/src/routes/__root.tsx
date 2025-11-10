import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
  useParams,
} from '@tanstack/react-router';
import * as React from 'react';
import appCss from '@/styles/app.css?url';
import { RootProvider } from 'fumadocs-ui/provider/tanstack';
import SearchDialog from '@/components/search';
import { defineI18nUI } from 'fumadocs-ui/i18n';
import { i18n } from '@/lib/i18n';
import { getTranslation } from '@/lib/translations';

const { provider } = defineI18nUI(i18n, {
  translations: {
    en: {
      displayName: 'English',
      search: getTranslation('en').common.search,
      searchPlaceholder: getTranslation('en').common.searchPlaceholder,
      toc: 'On this page',
      lastUpdate: 'Last updated on',
    },
    // Future translations can be added here
  },
});

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'OpenWorkflow - Durable Workflows Without the Complexity',
      },
      {
        name: 'description',
        content:
          'OpenWorkflow is a TypeScript framework for building reliable, long-running applications that survive crashes and deploys—all without extra servers to manage.',
      },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  const params = useParams({ strict: false });
  const lang = ('lang' in params ? params.lang : i18n.defaultLanguage) as string;

  return (
    <html suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="flex flex-col min-h-screen">
        <RootProvider search={{ SearchDialog }} i18n={provider(lang)}>
          {children}
        </RootProvider>
        <Scripts />
      </body>
    </html>
  );
}
