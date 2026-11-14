import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 20000,
  },
  resolve: {
    // The examples import the package by name, and the LLM SDKs are stubbed.
    alias: {
      gengwiki: here("./src/index.ts"),
      openai: here("./test/stubs/openai.ts"),
      "@anthropic-ai/sdk": here("./test/stubs/anthropic.ts"),
    },
  },
});
