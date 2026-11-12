import { describe, expect, it } from "vitest";
import { AuthError, UnavailableError } from "../src/errors";
import { KEY_A, KEY_B } from "./fake";
import { setup } from "./helpers";

const t = setup();

describe("status", () => {
  it("counts what the key was given", async () => {
    const s = await t.client().status();
    expect([s.persona, s.memes, s.people, s.missing, s.stale]).toEqual(["毒舌老哥", 2, 1, [], false]);
    expect(s.stickers).toBeGreaterThan(0);
    expect(s.quotes).toBeGreaterThan(0);
    const b = await t.client(KEY_B).status();
    expect([b.stickers, b.people]).toEqual([0, 0]);
  });

  it("names a missing scope and still counts the rest", async () => {
    t.fake.keys[KEY_A]!.scopes = ["memes:read"];
    const s = await t.client().status();
    expect(s.missing).toEqual(["persona:read", "stickers:read", "people:read", "trending:read"]);
    expect([s.persona, s.memes, s.stickers, s.people, s.quotes]).toEqual(["", 2, 0, 0, 0]);
  });

  it("throws for a bad key or a wiki out of reach", async () => {
    await expect(t.client("gwk_live_nope").status()).rejects.toThrow(AuthError);
    t.fake.status = 500;
    await expect(t.client().status()).rejects.toThrow(UnavailableError);
  });

  it("answers from the old copy in an outage and says so", async () => {
    const c = t.client();
    await c.status();
    c.refresh();
    t.fake.status = 500;
    expect((await c.status()).stale).toBe(true);
  });
});

describe("usage and rate limit", () => {
  it("are read live every time", async () => {
    const c = t.client();
    expect((await c.usage()).days[0].requests).toBe(3);
    expect((await c.rateLimit()).per_minute).toBe(600);
    await c.rateLimit();
    expect(c.requestCount).toBe(3);
  });

  it("need a key and say how to get one", async () => {
    const c = t.client(null);
    await expect(c.usage()).rejects.toThrow(/GENGWIKI_API_KEY/);
    await expect(c.rateLimit()).rejects.toThrow(AuthError);
    expect(c.requestCount).toBe(0);
  });
});
