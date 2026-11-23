import js from "@eslint/js";
import security from "eslint-plugin-security";
import globals from "globals";
import prettier from "eslint-config-prettier";

export default [
  {
    ignores: [
      "node_modules/**",
      "web/**/node_modules/**",
      "public/merchant/assets/**",
      "public/merchant/recursos/**",
      "public/ayuda/search/**",
      "public/revision-astryx/**/assets/**",
      "playwright-report/**",
      "test-results/**",
      "backups/**",
    ],
  },
  {
    ...js.configs.recommended,
    ...prettier,
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    plugins: {
      security,
    },
    rules: {
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-script-url": "error",
      "security/detect-eval-with-expression": "error",
      "security/detect-new-buffer": "error",
      "security/detect-non-literal-fs-filename": "warn",
      "security/detect-object-injection": "off",
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
];
