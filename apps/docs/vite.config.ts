import react from '@vitejs/plugin-react';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { defineConfig } from 'vite';
import tsConfigPaths from 'vite-tsconfig-paths';
import tailwindcss from '@tailwindcss/vite';
import { nitroV2Plugin } from "@tanstack/nitro-v2-vite-plugin";
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
          outputPath: 'index.html',
          enabled: true,
          crawlLinks: true,
        },
      },
      pages: [
        {
          path: '/docs',
        },
        {
          path: '/api/search',
        },
      ],
    }),
    nitroV2Plugin({ preset: "vercel", compatibilityDate: "2025-10-30" }),
    react(),
  ],
});
