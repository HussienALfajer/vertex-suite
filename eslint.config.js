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

/**
 * Nothing reads the ambient clock.
 *
 * A register runs for years on a machine whose clock nobody checks, and the
 * store node is the only thing in the shop that knows the real time. Code that
 * reads `Date.now()` directly cannot be corrected once that drift is found,
 * because there is no seam to correct it at. Every moment comes from a `Clock`,
 * and the one implementation that reads the machine is exempted below.
 */
const noAmbientTime = [
  {
    object: 'Date',
    property: 'now',
    message: 'Take the time from a Clock (@vertex/kernel). A device clock is a claim, not a fact.',
  },
];

const noAmbientDate = {
  selector: "NewExpression[callee.name='Date'][arguments.length=0]",
  message:
    'new Date() reads the ambient clock. Take the moment from a Clock; new Date(value) to convert one is fine.',
};

/**
 * `Math.random` is not unique enough to name a sale with, and `randomUUID`
 * produces a v4 — which carries no time, so nothing that relies on identifiers
 * sorting would hold. Identifiers come from the kernel.
 */
const noWeakRandom = [
  {
    object: 'Math',
    property: 'random',
    message:
      'Identifiers and tokens come from newId (@vertex/kernel), over a cryptographic source.',
  },
  {
    object: 'crypto',
    property: 'randomUUID',
    message: 'That is a v4: random, unordered, and hostile to every index it lands in. Use newId.',
  },
];

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
      'no-restricted-properties': ['error', ...noFloatOrigin, ...noAmbientTime, ...noWeakRandom],
      'no-restricted-syntax': ['error', noAmbientDate],
    },
  },

  {
    files: ['packages/kernel/src/**/*.ts'],
    rules: {
      'no-console': 'error',
      'no-restricted-properties': [
        'error',
        ...noFloatOrigin,
        ...noAdHocRounding,
        ...noAmbientTime,
        ...noWeakRandom,
      ],
    },
  },

  {
    // The one place the machine's own clock is read. Everything downstream of
    // it is a value it was handed.
    files: ['packages/kernel/src/clock.ts'],
    rules: {
      'no-restricted-properties': ['error', ...noFloatOrigin, ...noAdHocRounding, ...noWeakRandom],
    },
  },

  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  {
    // A test of the clock has to be able to compare it against the machine's.
    files: ['packages/kernel/src/**/*.test.ts'],
    rules: {
      'no-restricted-properties': ['error', ...noFloatOrigin, ...noAdHocRounding, ...noWeakRandom],
    },
  },

  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { ...globals.node } },
  },
);
