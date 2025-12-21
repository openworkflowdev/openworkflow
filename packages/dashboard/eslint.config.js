//  @ts-check

import { tanstackConfig } from '@tanstack/eslint-config'
import simpleImportSort from 'eslint-plugin-simple-import-sort'

export default [
  {
    ignores: ['eslint.config.js', 'prettier.config.js', 'vite.config.ts'],
  },
  ...tanstackConfig,
  {
    plugins: {
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      // Disable any conflicting import ordering rules from TanStack config
      'import/order': 'off',
      'sort-imports': 'off',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'separate-type-imports',
        },
      ],
      // Enable simple-import-sort
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
    },
  },
]
