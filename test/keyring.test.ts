import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSync } from "esbuild";
import { beforeEach, describe, expect, it } from "vitest";
import { GengWikiError } from "../src/errors";
import { Keyring, keychain } from "../src/keyring";

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

class FakeKeychain {
  saved = new Map<string, string>();
  reads = 0;
  refuse = false;
  get = (service: string, ref: string) => {
    this.reads++;
    return this.saved.get(`${service}|${ref}`) ?? null;
  };
  set = (service: string, ref: string, secret: string) => {
    if (this.refuse) throw new Error("locked");
    this.saved.set(`${service}|${ref}`, secret);
  };
  delete = (service: string, ref: string) => {
    this.saved.delete(`${service}|${ref}`);
  };
}

describe("Keyring with an OS keychain", () => {
  let chain: FakeKeychain;
  let ring: Keyring;
  const load = keychain.load;

  beforeEach(() => {
    chain = new FakeKeychain();
    keychain.load = () => chain;
    ring = new Keyring(path);
    return () => {
      keychain.load = load;
    };
  });

  const save = (name = "a", secret = "gwk_secret") =>
    ring.edit((d) => {
      d.keys[name] = { key: secret, id: "i" };
    });

  it("moves the secrets out of the file and still reads them back", () => {
    save();
    ring.edit((d) => {
      d.session = { token: "jwt_secret", expires_at: 1 };
    });
    const text = readFileSync(path, "utf8");
    expect(text).not.toContain("gwk_secret");
    expect(text).not.toContain("jwt_secret");
    const fresh = new Keyring(path).read();
    expect(fresh.keys.a).toEqual(expect.objectContaining({ key: "gwk_secret", id: "i" }));
    expect(fresh.session?.token).toBe("jwt_secret");
  });

  it("writes nothing to the keychain on an unrelated edit", () => {
    save();
    const before = new Map(chain.saved);
    ring.edit((d) => {
      d.current = "a";
    });
    expect(chain.saved).toEqual(before);
  });

  it("asks the keychain once however often it reads", () => {
    save();
    const other = new Keyring(path);
    for (let i = 0; i < 5; i++) other.read();
    expect(chain.reads).toBe(1);
  });

  it("removes a replaced or removed secret from the keychain", () => {
    save();
    save("a", "gwk_new");
    expect([...chain.saved.values()]).toEqual(["gwk_new"]);
    expect(new Keyring(path).read().keys.a!.key).toBe("gwk_new");
    ring.edit((d) => {
      delete d.keys.a;
    });
    expect(chain.saved.size).toBe(0);
  });

  it("sees a key another process rotated", () => {
    save();
    const other = new Keyring(path);
    expect(other.read().keys.a!.key).toBe("gwk_secret");
    save("a", "gwk_new");
    expect(other.read().keys.a!.key).toBe("gwk_new");
  });

  it("moves a plaintext file over on the next edit", () => {
    writeFileSync(path, JSON.stringify({ keys: { a: { key: "gwk_secret" } } }));
    expect(ring.read().keys.a!.key).toBe("gwk_secret");
    ring.edit((d) => {
      d.current = "a";
    });
    expect(readFileSync(path, "utf8")).not.toContain("gwk_secret");
    expect(ring.read().keys.a!.key).toBe("gwk_secret");
  });

  it("keeps a secret the keychain refuses in the file, with a warning", () => {
    chain.refuse = true;
    const warnings: string[] = [];
    ring = new Keyring(path, (m) => warnings.push(m));
    save();
    expect(warnings).toHaveLength(1);
    expect(readFileSync(path, "utf8")).toContain("gwk_secret");
    expect(ring.read().keys.a!.key).toBe("gwk_secret");
  });

  it("fails without losing anything when the keychain is gone", () => {
    save();
    const text = readFileSync(path, "utf8");
    keychain.load = () => null;
    expect(() => new Keyring(path).read()).toThrow(/@napi-rs\/keyring/);
    expect(() =>
      new Keyring(path).edit((d) => {
        d.current = "a";
      }),
    ).toThrow(GengWikiError);
    expect(readFileSync(path, "utf8")).toBe(text);
  });
});
