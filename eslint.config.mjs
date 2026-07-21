import coreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const config = [
  ...coreWebVitals,
  ...nextTypescript,
  {
    ignores: ['node_modules/**', '.next/**', 'convex/_generated/**'],
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
];

export default config;
