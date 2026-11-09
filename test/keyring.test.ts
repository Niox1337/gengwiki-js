import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSync } from "esbuild";
import { beforeEach, describe, expect, it } from "vitest";
import { GengWikiError } from "../src/errors";
import { Keyring } from "../src/keyring";

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gengwiki-keyring-"));
  path = join(dir, "keys.json");
});

const EDITOR = `
const [, , module, path, prefix] = process.argv;
const { Keyring } = await import(module);
const ring = new Keyring(path);
for (let i = 0; i < 25; i++) {
  ring.edit((d) => { d.keys[prefix + "-" + i] = { key: "x" }; });
  ring.read();
}
`;

describe("Keyring", () => {
  it("persists an edit without leaving a temp file or the lock", () => {
    const ring = new Keyring(path);
    expect(ring.read()).toEqual({ keys: {} });
    ring.edit((d) => {
      d.keys["人设"] = { key: "x" };
    });
    expect(new Keyring(path).read().keys["人设"]).toEqual({ key: "x" });
    expect(readdirSync(dir)).toEqual(["keys.json"]);
  });

  it.skipIf(process.platform === "win32")("is readable by the owner only", () => {
    new Keyring(path).edit((d) => {
      d.current = "a";
    });
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("never overwrites a corrupt file", () => {
    writeFileSync(path, "{oops");
    expect(() =>
      new Keyring(path).edit((d) => {
        d.current = "a";
      }),
    ).toThrow(GengWikiError);
    expect(readFileSync(path, "utf8")).toBe("{oops");
  });

  it("writes nothing when the change throws", () => {
    const ring = new Keyring(path);
    expect(() =>
      ring.edit((d) => {
        d.current = "a";
        throw new Error("changed my mind");
      }),
    ).toThrow("changed my mind");
    expect(ring.read()).toEqual({ keys: {} });
    ring.edit(() => {});
  });

  it("keeps every edit of processes saving at once", async () => {
    const module = join(dir, "keyring.mjs");
    buildSync({ entryPoints: ["src/keyring.ts"], bundle: true, platform: "node", format: "esm", outfile: module, logLevel: "silent" });
    const script = join(dir, "editor.mjs");
    writeFileSync(script, EDITOR);
    const runs = [0, 1, 2, 3].map(
      (n) =>
        new Promise<[number | null, string]>((done) => {
          const child = spawn(process.execPath, [script, module, path, String(n)]);
          let err = "";
          child.stderr.on("data", (c) => (err += c));
          child.on("close", (code) => done([code, err]));
        }),
    );
    for (const run of await Promise.all(runs)) expect(run).toEqual([0, ""]);
    expect(Object.keys(new Keyring(path).read().keys)).toHaveLength(100);
  });
});
