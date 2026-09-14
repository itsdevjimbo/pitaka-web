export default {
  trailingComma: 'all',
  singleQuote: true,
  printWidth: 120,
  htmlWhitespaceSensitivity: 'ignore',
  singleAttributePerLine: true,
  semi: true,
  arrowParens: 'always',
  overrides: [
    {
      files: '*.html',
      options: {
        parser: 'angular',
      },
    },
  ],
  plugins: ['prettier-plugin-packagejson', 'prettier-plugin-tailwindcss'],
  tailwindStylesheet: './src/styles/styles.css',
};
