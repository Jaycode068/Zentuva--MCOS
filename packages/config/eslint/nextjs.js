/** Shared ESLint rules for Zentuva Next.js apps. */
module.exports = {
  extends: ['./base.js', 'next/core-web-vitals'],
  rules: {
    'react/react-in-jsx-scope': 'off',
  },
};
