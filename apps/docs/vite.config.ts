import react from '@vitejs/plugin-react';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { defineConfig } from 'vite';
import tsConfigPaths from 'vite-tsconfig-paths';
import tailwindcss from '@tailwindcss/vite';
import { nitro } from 'nitro/vite'
import mdx from 'fumadocs-mdx/vite';

export default defineConfig({
  server: {
    port: 3000,
  },
  plugins: [
    mdx(await import('./source.config')),
    tailwindcss(),
    tsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tanstackStart({
      spa: {
        enabled: true,
        prerender: {
          enabled: true,
          crawlLinks: true,
        },
      },
      pages: [
        {
          path: '/en/docs',
        },
        {
          path: '/api/search',
        },
      ],
    }),
    nitro({
      publicAssets: [
        // this is a temporary fix to https://github.com/TanStack/router/issues/5368
        {
          dir: "dist/client/__tsr",
          baseURL: "/__tsr",
        },
      ],
    }),

    react(),
  ],
});
