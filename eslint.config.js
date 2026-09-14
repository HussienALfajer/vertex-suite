import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Restrictions that exist because of the specification, not because of taste.
 *
 * A monetary, quantity or rate value never originates from a JavaScript float.
 * `FX-07` fixes rounding to defined points with a recorded residual; a stray
 * `parseFloat` anywhere upstream makes that promise unverifiable.
 */
const noFloatOrigin = [
  {
    object: 'Number',
    property: 'parseFloat',
    message:
      'A business figure never originates from a float. Parse it as a decimal string through the kernel.',
  },
];

/**
 * `FX-07` gives every currency its own rounding increment and direction, and
 * requires the residual to be recorded. `Math.round` and friends do neither.
 */
const noAdHocRounding = ['round', 'floor', 'ceil', 'trunc'].map((property) => ({
  object: 'Math',
  property,
  message: `FX-07: rounding follows the currency rule and records its residual. Math.${property} does neither.`,
}));

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**', '**/coverage/**'],
  },

  js.configs.recommended,

  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },

  {
    files: ['**/src/**/*.ts', '**/src/**/*.tsx'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'parseFloat',
          message:
            'A business figure never originates from a float. Parse it as a decimal string through the kernel.',
        },
      ],
      'no-restricted-properties': ['error', ...noFloatOrigin],
    },
  },

  {
    files: ['packages/kernel/src/**/*.ts'],
    rules: {
      'no-console': 'error',
      'no-restricted-properties': ['error', ...noFloatOrigin, ...noAdHocRounding],
    },
  },

  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { ...globals.node } },
  },
);
