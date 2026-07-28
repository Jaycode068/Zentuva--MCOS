module.exports = {
  root: true,
  extends: [require.resolve('@zentuva/config/eslint/nextjs.js')],
  overrides: [
    {
      files: ['*.config.js'],
      rules: {
        '@typescript-eslint/no-require-imports': 'off',
      },
    },
  ],
};
