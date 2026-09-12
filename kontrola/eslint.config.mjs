import globals from 'globals'
export default [{
  files: ['**/*.js'],
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'script',
    globals: {
      ...globals.browser,
      supabase: 'readonly', pdfjsLib: 'readonly', PDFLib: 'readonly',
      html2canvas: 'readonly', jspdf: 'readonly', jsPDF: 'readonly'
    }
  },
  linterOptions: { reportUnusedDisableDirectives: false },
  rules: {
    'no-undef': 'error',
    'no-redeclare': 'error',
    'no-dupe-keys': 'error', 'no-dupe-args': 'error', 'no-dupe-else-if': 'error',
    'no-const-assign': 'error', 'no-func-assign': 'error', 'no-class-assign': 'error',
    'no-obj-calls': 'error', 'no-unreachable': 'error', 'no-setter-return': 'error',
    'no-self-assign': 'error', 'no-unsafe-negation': 'error', 'no-sparse-arrays': 'error',
    'use-isnan': 'error', 'getter-return': 'error', 'no-cond-assign': ['error', 'always'],
    'no-compare-neg-zero': 'error', 'no-duplicate-case': 'error'
  }
}]
