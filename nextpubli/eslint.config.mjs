import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import boundaries from "eslint-plugin-boundaries";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
  {
    plugins: { boundaries },
    settings: {
      "boundaries/elements": [
        { type: "app", pattern: "app/*" },
        { type: "features", pattern: "features/*" },
        { type: "components", pattern: "components/*" },
        { type: "lib", pattern: "lib/*" },
        { type: "mocks", pattern: "mocks/*" },
        { type: "types", pattern: "types/*" },
        { type: "schemas", pattern: "schemas/*" },
        { type: "copy", pattern: "copy/*" },
      ],
      "boundaries/ignore": ["**/*.test.*", "**/*.spec.*"],
    },
    rules: {
      "boundaries/element-types": [
        "error",
        {
          default: "disallow",
          rules: [
            {
              from: "app",
              allow: [
                "features",
                "components",
                "lib",
                "mocks",
                "types",
                "schemas",
                "copy",
              ],
            },
            {
              from: "features",
              allow: ["components", "lib", "types", "schemas", "copy"],
            },
            { from: "components", allow: ["lib", "types"] },
            { from: "lib", allow: ["lib", "types", "schemas"] },
            { from: "mocks", allow: ["types", "schemas"] },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
