import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GengWiki, TTL_CATALOG_MISS } from "../src/client";
import { AccountApiUnavailable, AuthError, NotFoundError } from "../src/errors";
import { namespace } from "../src/store";
import { KEY_A, KEY_B, PACK, PERSONA_A, PERSONA_B } from "./fake";
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

describe("usePersona", () => {
  const saved = () => {
    const c = t.client(null);
    c.keys.add("a", KEY_A);
    c.keys.add("b", KEY_B);
    return c;
  };

  it("changes the prompt and the scope", async () => {
    const c = saved();
    expect((await c.usePersona("温柔姐姐")).prompt).toBe("你是温柔姐姐");
    expect(await slugs(c)).toEqual(["yyds"]);
    expect((await c.persona())!.id).toBe(PERSONA_B);
    expect((await c.usePersona(PERSONA_A)).title).toBe("毒舌老哥");
    expect(new Set(await slugs(c))).toEqual(new Set(["tang-ping", "yyds"]));
  });

  it("is free once both personas were seen", async () => {
    const c = saved();
    await c.usePersona("毒舌老哥");
    await c.usePersona("温柔姐姐");
    await c.searchMemes();
    const before = c.requestCount;
    for (let i = 0; i < 5; i++) {
      await c.usePersona("毒舌老哥");
      await c.persona();
      await c.usePersona("温柔姐姐");
      await c.persona();
      await c.searchMemes("yyds");
    }
    expect(c.requestCount).toBe(before);
  });

  it("sees an edit after refresh on every saved key", async () => {
    const c = saved();
    await c.usePersona("温柔姐姐");
    await c.usePersona("毒舌老哥");
    t.fake.personas[PERSONA_B]!.prompt = "改过了";
    c.refresh();
    expect((await c.usePersona("温柔姐姐")).prompt).toBe("改过了");
  });

  it("finds a renamed persona on the saved key", async () => {
    const c = saved();
    await c.usePersona("温柔姐姐");
    t.fake.personas[PERSONA_B]!.title = "新名字";
    c.refresh();
    expect((await c.usePersona("新名字")).id).toBe(PERSONA_B);
    expect(c.keys.local()).toHaveLength(2);
  });

  it("is remembered across a restart", async () => {
    await saved().usePersona("温柔姐姐");
    const c = t.client(null);
    expect((await c.persona())!.title).toBe("温柔姐姐");
    expect(c.requestCount).toBe(0);
  });

  it("keeps the old persona when it fails", async () => {
    const c = saved();
    await expect(c.usePersona("没有这个人设")).rejects.toThrow(/log in/);
    expect((await c.persona())!.title).toBe("毒舌老哥");
  });

  it("skips a revoked key", async () => {
    const c = saved();
    t.fake.keys[KEY_A]!.revoked = true;
    expect((await c.usePersona("温柔姐姐")).title).toBe("温柔姐姐");
  });

  it("creates the key with the persona's scope after a login", async () => {
    const c = t.client(null);
    await c.keys.login("me@example.com", "correct horse");
    expect((await c.usePersona("毒舌老哥")).prompt).toBe("你是毒舌老哥");
    const made = Object.values(t.fake.keys).find((k) => k.name === "毒舌老哥")!;
    expect([made.persona, made.memes, made.packs]).toEqual([PERSONA_A, ["tang-ping"], [PACK]]);
    expect(await slugs(c)).toEqual(["tang-ping"]);
    const count = Object.keys(t.fake.keys).length;
    await c.usePersona("毒舌老哥");
    expect(Object.keys(t.fake.keys)).toHaveLength(count);
  });

  it("names the published persona on a near miss", async () => {
    const c = t.client(null);
    await c.keys.login("me@example.com", "correct horse");
    await expect(c.usePersona("姐姐")).rejects.toThrow(/温柔姐姐/);
    expect(t.fake.count("/api/personas")).toBe(1);
    expect(Object.values(t.fake.keys).map((k) => k.name)).not.toContain("姐姐");
  });

  it("finds a newly published persona without waiting a day", async () => {
    const published = t.fake.personas[PERSONA_B]!;
    delete t.fake.personas[PERSONA_B];
    const c = t.client(null);
    await c.keys.login("me@example.com", "correct horse");
    expect(await c.personas()).toHaveLength(1);
    await expect(c.usePersona("温柔姐姐")).rejects.toThrow(NotFoundError);
    expect(t.fake.count("/api/personas")).toBe(1);
    t.fake.personas[PERSONA_B] = published;
    const later = Date.now() + (TTL_CATALOG_MISS + 1) * 1000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    expect((await c.usePersona("温柔姐姐")).prompt).toBe("你是温柔姐姐");
    expect(t.fake.count("/api/personas")).toBe(2);
  });

  it("lists the saved keys' personas where the site hides the catalog", async () => {
    t.fake.accountOpen = false;
    const c = saved();
    await c.usePersona("温柔姐姐");
    expect(new Set((await c.personas()).map((p) => p.title))).toEqual(new Set(["毒舌老哥", "温柔姐姐"]));
    await c.personas();
    expect(t.fake.count("/api/personas")).toBe(1);
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
