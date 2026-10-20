import security from "eslint-plugin-security";
import tseslint from "typescript-eslint";

export default [
  { ignores: ["**/node_modules/**", "**/dist/**", "**/.output/**", "**/.tanstack/**"] },
  {
    files: ["apps/**/*.{ts,tsx,mjs}", "packages/**/*.{ts,cjs,mjs}", "supabase/functions/**/*.ts"],
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" },
    languageOptions: { parser: tseslint.parser },
    plugins: { security },
    // Heuristic hotspots remain visible as warnings for human review. These
    // specific unsafe primitives fail CI; no blanket suppression of warnings.
    rules: {
      ...security.configs.recommended.rules,
      "security/detect-eval-with-expression": "error",
      "security/detect-new-buffer": "error",
      "security/detect-pseudoRandomBytes": "error",
      "security/detect-disable-mustache-escape": "error",
      "security/detect-bidi-characters": "error",
    },
  },
];
