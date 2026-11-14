import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KEY_A, KEY_B } from "./fake";
import { setup } from "./helpers";

vi.mock("node:readline/promises", () => {
  const answers = ["躺平是什么？", ""];
  return { createInterface: () => ({ question: async () => answers.shift() ?? "", close: () => {} }) };
});

const t = setup();
const folder = join(import.meta.dirname, "..", "examples");
const VARS = ["GENGWIKI_API_URL", "GENGWIKI_SITE_URL", "GENGWIKI_HOME", "GENGWIKI_API_KEY", "GENGWIKI_PASSWORD"];
const saved = Object.fromEntries(VARS.map((k) => [k, process.env[k]]));

afterEach(() => {
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// Runs every example against the fake server, so the examples cannot drift from the SDK.
describe("examples", () => {
  for (const file of readdirSync(folder).filter((f) => f.endsWith(".mjs")).sort()) {
    it(file, async () => {
      const keys = t.client(null).keys;
      keys.add("a", KEY_A);
      keys.add("b", KEY_B);
      Object.assign(process.env, {
        GENGWIKI_API_URL: t.url,
        GENGWIKI_SITE_URL: t.url,
        GENGWIKI_HOME: t.dir,
        GENGWIKI_API_KEY: "",
        GENGWIKI_PASSWORD: "correct horse",
      });
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      await import(pathToFileURL(join(folder, file)).href);
      expect(log).toHaveBeenCalled();
      // api_keys stays on this machine
      if (file !== "api_keys.mjs") expect(t.fake.hits.length).toBeGreaterThan(0);
    });
  }
});
