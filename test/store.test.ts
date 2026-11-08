import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Store, namespace } from "../src/store";

const dir = () => mkdtempSync(join(tmpdir(), "gengwiki-store-"));

describe("Store", () => {
  it("never files a row under the key itself", () => {
    expect(namespace("gwk_live_secret")).toHaveLength(16);
    expect(namespace("gwk_live_secret")).not.toContain("secret");
    expect(namespace(null)).toBe(namespace(""));
  });

  it("keeps rows across instances and expires them without losing them", () => {
    const path = join(dir(), "cache.sqlite3");
    const a = new Store(path);
    a.put("ns", "k", [{ title: "躺平" }]);
    a.close();
    const b = new Store(path);
    expect(b.get("ns", "k")?.value).toEqual([{ title: "躺平" }]);
    expect(b.get("ns", "k")!.age).toBeLessThan(5);
    b.expire("ns");
    expect(b.get("ns", "k")!.age).toBeGreaterThan(1e9);
    b.rename("ns", "other");
    expect(b.get("ns", "k")).toBeNull();
    expect(b.get("other", "k")?.value).toEqual([{ title: "躺平" }]);
    b.drop("other");
    expect(b.get("other", "k")).toBeNull();
    b.close();
  });

  it("starts over on a corrupt file", () => {
    const path = join(dir(), "cache.sqlite3");
    writeFileSync(path, "this is not a database".repeat(100));
    const s = new Store(path);
    s.put("ns", "k", 1);
    expect(s.get("ns", "k")?.value).toBe(1);
    s.close();
  });

  it("reads a closed cache as a miss", () => {
    const s = new Store(join(dir(), "cache.sqlite3"));
    s.put("ns", "k", 1);
    s.close();
    expect(s.get("ns", "k")).toBeNull();
    s.put("ns", "k", 2);
    expect(s.get("ns", "k")).toBeNull();
  });
});
