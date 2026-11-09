import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GengWiki, OUTAGE_PAUSE } from "../src/client";
import { AuthError, BadResponseError, NotFoundError, RateLimitError, ServerError } from "../src/errors";
import { KEY_A, KEY_B, meme } from "./fake";
import { setup } from "./helpers";

const t = setup();
const slugs = (rows: { slug: string }[]) => rows.map((r) => r.slug);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("memes", () => {
  it("answers many searches from one request", async () => {
    const c = t.client();
    expect(slugs(await c.searchMemes("躺平"))).toEqual(["tang-ping"]);
    expect(slugs(await c.searchMemes("永远的神"))).toEqual(["yyds"]);
    expect(await c.searchMemes("完全不存在")).toEqual([]);
    expect(slugs(await c.searchMemes())).toEqual(["tang-ping", "yyds"]);
    expect(c.requestCount).toBe(1);
  });

  it("needs no request in a new process", async () => {
    await t.client().searchMemes("躺平");
    const c = t.client();
    expect((await c.searchMemes("躺平"))[0]!.title).toBe("躺平");
    expect(c.requestCount).toBe(0);
  });

  it("caches the detail and finds it by alias", async () => {
    const c = t.client();
    expect((await c.meme("tang-ping")).body).toBe("躺平的正文");
    expect((await c.meme("摆烂")).slug).toBe("tang-ping");
    expect(t.fake.count("/v1/memes/tang-ping")).toBe(1);
    expect(c.requestCount).toBe(2);
  });

  it("reads an edited meme again once the list refreshes, and an unchanged one never", async () => {
    const c = t.client();
    await c.meme("yyds");
    await c.meme("tang-ping");
    t.fake.memes.yyds = meme("yyds", "新标题", 5, [], "2026-02-02T00:00:00Z");
    c.refresh();
    expect((await c.meme("yyds")).title).toBe("新标题");
    await c.meme("tang-ping");
    expect(t.fake.count("/v1/memes/tang-ping")).toBe(1);
  });

  it("refuses a slug outside the scope without a request, and never leaks the shared copy", async () => {
    await t.client(KEY_A).meme("tang-ping");
    const c = t.client(KEY_B);
    await expect(c.meme("tang-ping")).rejects.toBeInstanceOf(NotFoundError);
    expect(t.fake.count("/v1/memes/tang-ping")).toBe(1);
    expect(c.requestCount).toBe(1);
  });

  it("shares the text with a second key", async () => {
    await t.client(KEY_A).meme("yyds");
    expect((await t.client(KEY_B).meme("yyds")).body).toBe("YYDS的正文");
    expect(t.fake.count("/v1/memes/yyds")).toBe(1);
  });

  it("asks the server once the list is cut off", async () => {
    for (let i = 0; i < 120; i++) {
      const m = meme(`m${i}`, `梗${i}`, 1000 - i);
      t.fake.memes[m.slug] = m;
      t.fake.keys[KEY_A]!.memes.push(m.slug);
    }
    const c = t.client();
    // past the first 100 by heat
    expect((await c.searchMemes("梗119"))[0]!.slug).toBe("m119");
    await c.searchMemes("梗119");
    expect(c.requestCount).toBe(2);
    expect((await c.meme("m119")).slug).toBe("m119");
    await c.meme("m119");
    expect(t.fake.count("/v1/memes/m119")).toBe(1);
    await expect(c.meme("nope")).rejects.toBeInstanceOf(NotFoundError);
    await expect(c.meme("nope")).rejects.toBeInstanceOf(NotFoundError);
    // a miss is remembered too
    expect(t.fake.count("/v1/memes/nope")).toBe(1);
  });

  it("serves any trending limit and every key from one request", async () => {
    const c = t.client();
    expect(await c.trending("", 1)).toHaveLength(1);
    expect(await c.trending("", 2)).toHaveLength(2);
    expect((await t.client(KEY_B).trending())[0]!.slug).toBe("tang-ping");
    expect(t.fake.count("/v1/trending")).toBe(1);
  });

  it("carries the usage scenario on lists, detail and related", async () => {
    t.fake.memes["tang-ping"]!.related = [{ slug: "yyds", usage_scenario: "夸人时" }];
    const c = t.client();
    expect((await c.searchMemes("躺平"))[0]!.usage_scenario).toBe("躺平的场景");
    expect((await c.trending())[0]!.usage_scenario).toBe("躺平的场景");
    expect((await c.meme("tang-ping")).related[0]!.usage_scenario).toBe("夸人时");
  });

  it("searches the hot board too in findMemes", async () => {
    t.fake.keys[KEY_B]!.memes = [];
    expect(slugs(await t.client(KEY_B).findMemes("躺平"))).toEqual(["tang-ping"]);
  });
});

describe("outages", () => {
  it("serves the stale copy without retrying", async () => {
    const c = t.client();
    await c.searchMemes();
    for (const status of [500, 429]) {
      c.refresh();
      t.fake.status = status;
      const before = c.requestCount;
      const started = performance.now();
      expect((await c.searchMemes("躺平"))[0]!.slug).toBe("tang-ping");
      expect(c.requestCount).toBe(before + 1);
      expect(performance.now() - started).toBeLessThan(400);
      expect(c.stale).toBe(true);
    }
    t.fake.status = null;
    c.refresh();
    expect(c.stale).toBe(false);
    await c.searchMemes();
    expect(c.stale).toBe(false);
  });

  it("raises without a copy", async () => {
    t.fake.status = 500;
    await expect(t.client().searchMemes()).rejects.toBeInstanceOf(ServerError);
    t.fake.status = 429;
    const err = await t.client().searchMemes().catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.retryAfter).toBe(3600);
  });

  it("serves the stale copy on a 200 in HTML, and caches nothing from it", async () => {
    const c = t.client();
    t.fake.htmlOk = true;
    await expect(c.searchMemes()).rejects.toThrow(/text\/html/);
    t.fake.htmlOk = false;
    await c.searchMemes();
    c.refresh();
    t.fake.htmlOk = true;
    expect((await c.searchMemes("躺平"))[0]!.slug).toBe("tang-ping");
  });

  it("keeps no JSON of the wrong shape and serves the stale copy instead", async () => {
    const c = t.client();
    t.fake.jsonOk = { message: "ok" };
    await expect(c.searchMemes("躺平")).rejects.toBeInstanceOf(BadResponseError);
    t.fake.jsonOk = undefined;
    expect((await c.searchMemes("躺平"))[0]!.slug).toBe("tang-ping");
    c.refresh();
    t.fake.jsonOk = { message: "ok" };
    expect((await c.searchMemes("躺平"))[0]!.slug).toBe("tang-ping");
  });

  it("gives a revoked key an auth error, not stale data", async () => {
    const c = t.client();
    await c.searchMemes();
    c.refresh();
    t.fake.keys[KEY_A]!.revoked = true;
    await expect(c.searchMemes()).rejects.toBeInstanceOf(AuthError);
  });

  it("asks once, then waits out the pause", async () => {
    const c = t.client();
    await c.searchMemes();
    c.refresh();
    t.fake.status = 500;
    for (let i = 0; i < 5; i++) await c.searchMemes("躺平");
    // the first read, and one failed refresh
    expect(t.fake.count("/v1/memes/search")).toBe(2);
    const later = Date.now() + (OUTAGE_PAUSE + 1) * 1000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    await c.searchMemes("躺平");
    expect(t.fake.count("/v1/memes/search")).toBe(3);
  });

  it("waits for the whole Retry-After", async () => {
    const c = t.client();
    await c.searchMemes();
    c.refresh();
    // the fake says Retry-After 3600
    t.fake.status = 429;
    await c.searchMemes("躺平");
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 3000 * 1000);
    await c.searchMemes("躺平");
    expect(t.fake.count("/v1/memes/search")).toBe(2);
  });

  it("ends the wait on refresh and sees the recovery", async () => {
    const c = t.client();
    await c.searchMemes();
    c.refresh();
    t.fake.status = 500;
    await c.searchMemes("躺平");
    t.fake.status = null;
    t.fake.memes["tang-ping"]!.title = "躺平二";
    c.refresh();
    expect((await c.searchMemes("躺平"))[0]!.title).toBe("躺平二");
  });
});

describe("client", () => {
  it("takes an API address with /v1", async () => {
    const c = new GengWiki({ apiKey: KEY_A, baseUrl: t.url + "/v1/", siteUrl: t.url, home: t.dir });
    expect(c.baseUrl).toBe(t.url);
    expect((await c.searchMemes())[0]!.slug).toBe("tang-ping");
    c.close();
  });

  it("defaults to production", () => {
    const c = new GengWiki({ home: t.dir });
    expect([c.baseUrl, c.siteUrl]).toEqual(["https://api.gengwiki.com", "https://gengwiki.com"]);
    c.close();
  });

  it("shares one fetch for the same miss and lets unrelated ones run at once", async () => {
    const c = t.client();
    const fetched: string[] = [];
    let inside = 0;
    let most = 0;
    vi.spyOn(c.http, "json").mockImplementation(async (_m, url) => {
      fetched.push(url);
      most = Math.max(most, ++inside);
      await new Promise((r) => setTimeout(r, 30));
      inside--;
      return [];
    });
    await Promise.all([...Array(8)].map(() => c.v1("same", "/x", 60, { expect: Array })));
    expect(fetched).toHaveLength(1);
    await Promise.all([c.v1("a", "/a", 60, { expect: Array }), c.v1("b", "/b", 60, { expect: Array })]);
    expect(most).toBe(2);
  });

  it("never writes the key to the cache folder", async () => {
    const c = t.client();
    await c.searchMemes();
    c.close();
    for (const f of readdirSync(c.home)) expect(readFileSync(join(c.home, f)).includes(KEY_A), f).toBe(false);
  });
});
