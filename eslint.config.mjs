import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettier from 'eslint-config-prettier'

const buildConfig = async () => {
  try {
    const tseslint = (await import('typescript-eslint')).default
    return tseslint.config(
      {
        ignores: [
          'out/**',
          'dist/**',
          'release/**',
          'node_modules/**',
          '.github/scripts/**',
          'coverage/**',
          'test-results/**',
          'playwright-report/**',
          'blob-report/**'
        ]
      },
      js.configs.recommended,
      ...tseslint.configs.recommended,
      {
        files: ['**/*.{ts,tsx}'],
        languageOptions: {
          globals: {
            ...globals.node,
            ...globals.browser
          },
          parserOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module'
          }
        },
        plugins: {
          'react-hooks': reactHooks,
          'react-refresh': reactRefresh
        },
        rules: {
          'react-hooks/rules-of-hooks': 'error',
          'react-hooks/exhaustive-deps': 'warn',
          'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
          '@typescript-eslint/consistent-type-imports': [
            'warn',
            { prefer: 'type-imports', fixStyle: 'inline-type-imports' }
          ],
          '@typescript-eslint/no-unused-vars': [
            'error',
            { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
          ]
        }
      },
      {
        files: ['tests/e2e/fixtures.ts'],
        rules: {
          'no-empty-pattern': 'off'
        }
      },
      {
        files: ['tests/e2e/**/*.ts'],
        rules: {
          '@typescript-eslint/no-explicit-any': 'off',
          '@typescript-eslint/no-unused-vars': 'off'
        }
      },
      prettier
    )
  } catch {
    return [{ ignores: [], linterOptions: { reportUnusedDisableDirectives: 'off' } }]
  }
}

export default buildConfig()
