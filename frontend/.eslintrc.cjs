module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
  settings: { react: { version: 'detect' } },
  plugins: ['react', 'react-hooks'],
  extends: ['eslint:recommended', 'plugin:react/recommended', 'plugin:react-hooks/recommended'],
  rules: {
    /* 新 JSX transform 不需要把 React 引进作用域 */
    'react/react-in-jsx-scope': 'off',
    /* 这是一个内部演示前端，用 propTypes 换不来实际的类型安全 */
    'react/prop-types': 'off',
    /* demo.js 里我们自己写的富文本要用它，边界写在 RichText.jsx 顶部 */
    'react/no-danger': 'off',
    'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-nested-ternary': 'off',
    /* 中文文案里的全角空格（　）是排版的一部分，不是打字错误 */
    'no-irregular-whitespace': ['error', {
      skipStrings: true, skipTemplates: true, skipJSXText: true, skipComments: true,
    }],
  },
  ignorePatterns: ['dist', 'node_modules'],
};
