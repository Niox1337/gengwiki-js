import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GengWiki } from "../src/client";
import { AccountApiUnavailable, AuthError, NotFoundError } from "../src/errors";
import { namespace } from "../src/store";
import { KEY_A, KEY_B } from "./fake";
import { setup } from "./helpers";

const t = setup();

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.GENGWIKI_API_KEY;
});

const slugs = async (c: GengWiki, q = "") => (await c.searchMemes(q)).map((m) => m.slug);

describe("keys saved on this machine", () => {
  it("are used by new clients", async () => {
    const c = t.client(null);
    const k = c.keys.add("老哥", KEY_A);
    expect(k.current).toBe(true);
    expect(k.prefix).toBe(KEY_A.slice(0, 15));
    expect((await slugs(t.client(null)))[0]).toBe("tang-ping");
  });

  it("lose to an explicit key, which is not saved", async () => {
    t.client(null).keys.add("老哥", KEY_A);
    const other = t.client(KEY_B);
    expect(await slugs(other)).toEqual(["yyds"]);
    expect(other.keys.local().map((k) => k.name)).toEqual(["老哥"]);
  });

  it("lose to GENGWIKI_API_KEY", async () => {
    process.env.GENGWIKI_API_KEY = KEY_B;
    expect(await slugs(t.client(null))).toEqual(["yyds"]);
  });

  it("refuse junk and overwrites", () => {
    const c = t.client(null);
    expect(() => c.keys.add("x", "sk-not-ours")).toThrow(TypeError);
    c.keys.add("x", KEY_A);
    c.keys.add("x", KEY_A);
    expect(() => c.keys.add("x", KEY_B)).toThrow(TypeError);
    expect(c.keys.secret("x")).toBe(KEY_A);
  });

  it("switch and go", async () => {
    const c = t.client(null);
    c.keys.add("a", KEY_A);
    c.keys.add("b", KEY_B);
    expect(c.keys.use("b").current).toBe(true);
    expect(await slugs(c)).toEqual(["yyds"]);
    expect(await slugs(t.client(null))).toEqual(["yyds"]);
    expect(() => c.keys.use("nope")).toThrow(NotFoundError);
    c.keys.remove("b");
    expect(c.keys.local().map((k) => k.name)).toEqual(["a"]);
  });

  it("throw the SDK error for an unknown name", () => {
    expect(() => t.client(null).keys.secret("nope")).toThrow(NotFoundError);
  });

  it("stop this client using the current key once removed", () => {
    const c = t.client(null);
    c.keys.add("a", KEY_A);
    c.keys.add("b", KEY_B);
    c.keys.remove("a");
    expect(c.key).toBeNull();
    expect(() => c.token()).toThrow(/keys\.use.*b/);
  });

  it("say where to get a key when there is none", () => {
    expect(() => t.client(null).token()).toThrow(AuthError);
    expect(() => t.client(null).token()).toThrow(/\/me/);
  });

  it("are never shown to another host", () => {
    t.client(null).keys.add("a", KEY_A);
    const c = new GengWiki({ baseUrl: "http://127.0.0.1:9", siteUrl: t.url, home: t.dir, logger: { warn: () => {} } });
    try {
      expect(c.keys.local()).toEqual([]);
    } finally {
      c.close();
    }
  });
});

describe("account API", () => {
  const loggedIn = async () => {
    const c = t.client(null);
    await c.keys.login("me@example.com", "correct horse");
    return c;
  };

  it("refuses a wrong password", async () => {
    const c = t.client(null);
    await expect(c.keys.login("me@example.com", "wrong")).rejects.toThrow(AuthError);
    expect(c.keys.loggedIn).toBe(false);
  });

  it("does not store the password", async () => {
    const c = await loggedIn();
    expect(readFileSync(join(c.home, "keys.json"), "utf8")).not.toContain("correct horse");
    expect(t.client(null).keys.loggedIn).toBe(true);
  });

  it("needs a login before any request", async () => {
    const c = t.client(null);
    await expect(c.keys.list()).rejects.toThrow(/login/);
    expect(c.requestCount).toBe(0);
  });

  it("clears an expired session", async () => {
    const c = await loggedIn();
    c.keyring.edit((d) => {
      d.session!.token = "stale";
    });
    await expect(c.keys.list()).rejects.toThrow(AuthError);
    expect(c.keys.loggedIn).toBe(false);
  });

  it("says what to do where the site hides it", async () => {
    t.fake.accountOpen = false;
    const login = t.client(null).keys.login("me@example.com", "correct horse");
    await expect(login).rejects.toThrow(AccountApiUnavailable);
    await expect(login).rejects.toThrow(/keys\.add/);
  });

  it("saves the one time secret on create", async () => {
    const c = await loggedIn();
    const k = await c.keys.create("新的", { memes: ["yyds"] });
    const secret = c.keys.secret("新的");
    expect(t.fake.keys[secret]!.memes).toEqual(["yyds"]);
    expect(k.prefix).toBe(secret.slice(0, 15));
    expect(k.current).toBe(true);
    expect(await slugs(c)).toEqual(["yyds"]);
  });

  it("keeps both keys created under one name", async () => {
    const c = await loggedIn();
    const a = await c.keys.create("同名");
    const b = await c.keys.create("同名");
    expect(a.name).not.toBe(b.name);
    expect(c.keys.secret(a.name)).not.toBe(c.keys.secret(b.name));
  });

  it("hides revoked keys from the list", async () => {
    const c = await loggedIn();
    t.fake.keys[KEY_B]!.revoked = true;
    expect(new Set((await c.keys.list()).map((k) => k.name))).toEqual(new Set(["a"]));
    expect(new Set((await c.keys.list({ includeRevoked: true })).map((k) => k.name))).toEqual(new Set(["a", "b"]));
  });

  it("rotates with the cache kept and the client switched", async () => {
    const c = await loggedIn();
    c.keys.add("a", KEY_A);
    await c.searchMemes();
    const before = t.fake.count("/v1/");
    const k = await c.keys.rotate("a");
    expect(k.name).toBe("a");
    expect(k.current).toBe(true);
    expect(c.keys.secret("a")).not.toBe(KEY_A);
    await c.searchMemes();
    expect(t.fake.count("/v1/")).toBe(before);
    c.refresh();
    await c.searchMemes();
    expect(t.fake.count("/v1/")).toBe(before + 1);
    expect(t.fake.keys[KEY_A]!.revoked).toBe(true);
  });

  it("saves the new secret when rotating an unsaved key", async () => {
    const c = t.client(KEY_A);
    await c.keys.login("me@example.com", "correct horse");
    expect((await c.keys.rotate("a")).name).toBe("a");
    c.refresh();
    await c.searchMemes();
  });

  it("revokes a key everywhere", async () => {
    const c = await loggedIn();
    c.keys.add("a", KEY_A);
    await c.searchMemes();
    await c.keys.revoke("a");
    expect(t.fake.keys[KEY_A]!.revoked).toBe(true);
    expect(c.keys.local()).toEqual([]);
    expect(() => c.token()).toThrow(AuthError);
    expect(c.store.get(namespace(KEY_A), "list")).toBeNull();
  });

  it("revokes by remote name and refuses an ambiguous one", async () => {
    const c = await loggedIn();
    await c.keys.revoke("b");
    expect(t.fake.keys[KEY_B]!.revoked).toBe(true);
    await c.keys.create("同名");
    await c.keys.create("同名");
    c.keyring.edit((d) => {
      d.keys = {};
    });
    await expect(c.keys.revoke("同名")).rejects.toThrow(TypeError);
    await expect(c.keys.revoke("不存在")).rejects.toThrow(NotFoundError);
  });
});
