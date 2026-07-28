/** Shared ESLint rules for Zentuva React component libraries. */
module.exports = {
  extends: ['./base.js', 'plugin:react/recommended', 'plugin:react-hooks/recommended'],
  parserOptions: {
    ecmaFeatures: { jsx: true },
  },
  settings: {
    react: { version: 'detect' },
  },
  rules: {
    'react/react-in-jsx-scope': 'off',
    'react/prop-types': 'off',
  },
};
