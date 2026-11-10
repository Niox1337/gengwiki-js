import { beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, UnavailableError } from "../src/errors";
import { KEY_A, KEY_B, meme } from "./fake";
import { setup } from "./helpers";

const t = setup();
const slugs = (rows: { slug: string }[]) => rows.map((r) => r.slug);

beforeEach(() => {
  // A full hot board, so nothing with this tag gets in except through a subscription.
  for (let i = 0; i < 100; i++) t.fake.memes[`hot-${i}`] = meme(`hot-${i}`, `热${i}`, 100 + i);
  for (let i = 1; i < 7; i++) {
    const m = meme(`game-${i}`, `游戏${i}`, 10 - i);
    m.categories = ["游戏"];
    t.fake.memes[m.slug] = m;
  }
});

const tag = (slug: string, title: string, name: string) => {
  const m = meme(slug, title, 1);
  m.categories = [name];
  t.fake.memes[slug] = m;
};

describe("tags", () => {
  it("lists every tag once for all keys", async () => {
    const c = t.client();
    expect((await c.tags()).map((x) => [x.name, x.count])).toEqual([
      ["网络", 102],
      ["游戏", 6],
    ]);
    await t.client(KEY_B).tags();
    expect(t.fake.count("/v1/tags")).toBe(1);
    t.fake.keys[KEY_A]!.scopes = ["memes:read"];
    c.refresh();
    await expect(c.tags()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("saves a subscription for every key and later clients", async () => {
    const top = await t.client().subscribe(" 游戏 ");
    expect(slugs(top)).toEqual([1, 2, 3, 4, 5].map((i) => `game-${i}`));
    await t.client().subscribe("游戏");
    expect(t.client(KEY_B).subscriptions()).toEqual(["游戏"]);
    expect(t.client().unsubscribe("游戏")).toBe(true);
    expect(t.client().unsubscribe("游戏")).toBe(false);
    expect(t.client().subscriptions()).toEqual([]);
  });

  it("refuses an unknown tag and saves nothing", async () => {
    const c = t.client();
    for (const name of ["没有这个", "", "  "]) await expect(c.subscribe(name)).rejects.toBeInstanceOf(NotFoundError);
    expect(c.subscriptions()).toEqual([]);
  });

  it("checks an empty board again within a minute", async () => {
    const c = t.client();
    await expect(c.subscribe("新标签")).rejects.toBeInstanceOf(NotFoundError);
    const sent = t.fake.count("/v1/trending");
    await expect(c.subscribe("新标签")).rejects.toBeInstanceOf(NotFoundError);
    expect(t.fake.count("/v1/trending")).toBe(sent);
    tag("new-1", "新梗", "新标签");
    c.refresh();
    expect(slugs(await c.subscribe("新标签"))).toEqual(["new-1"]);
  });
});

describe("findMemes", () => {
  it("covers the subscribed tags and the hot board", async () => {
    const c = t.client();
    expect(await c.searchMemes("游戏1")).toEqual([]);
    expect(await c.findMemes("游戏1")).toEqual([]);
    await c.subscribe("游戏");
    expect((await c.findMemes("游戏1"))[0]!.slug).toBe("game-1");
    expect((await c.findMemes("热5"))[0]!.slug).toBe("hot-5");
    expect((await c.findMemes("躺平"))[0]!.slug).toBe("tang-ping");
    // this one stays with the key's own
    expect(await c.searchMemes("游戏1")).toEqual([]);
    // only the top five
    expect(slugs(await c.findMemes("游戏6", 100))).not.toContain("game-6");
    expect(await c.findMemes("游戏1", 20, { tags: [] })).toEqual([]);
    c.unsubscribe("游戏");
    expect((await c.findMemes("游戏1", 20, { tags: ["游戏"] }))[0]!.slug).toBe("game-1");
  });

  it("lists each meme once and reaches past a cut off list", async () => {
    t.fake.memes["tang-ping"]!.categories = ["游戏"];
    t.fake.memes["tang-ping"]!.heat = 50;
    const c = t.client();
    await c.subscribe("游戏");
    expect((await c.findMemes("", 100)).filter((m) => m.slug === "tang-ping")).toHaveLength(1);
    t.fake.memes.far = meme("far", "很远的梗", 0);
    t.fake.keys[KEY_A]!.memes = [...[...Array(100)].map((_, i) => `hot-${i}`), "far"];
    c.refresh();
    expect((await c.findMemes("很远的梗"))[0]!.slug).toBe("far");
  });

  it("works with either scope alone", async () => {
    const c = t.client();
    t.fake.keys[KEY_A]!.scopes = ["trending:read"];
    expect((await c.findMemes("热5"))[0]!.slug).toBe("hot-5");
    t.fake.keys[KEY_A]!.scopes = ["memes:read"];
    c.refresh();
    expect((await c.findMemes("躺平"))[0]!.slug).toBe("tang-ping");
  });

  it("keeps the key's memes through an outage on the hot board", async () => {
    const c = t.client();
    await c.searchMemes();
    t.fake.status = 500;
    expect((await c.findMemes("躺平"))[0]!.slug).toBe("tang-ping");
    await expect(c.trending("没读过")).rejects.toBeInstanceOf(UnavailableError);
  });
});
