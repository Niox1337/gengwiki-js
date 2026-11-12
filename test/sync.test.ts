import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KEY_B, STICKER } from "./fake";
import { setup } from "./helpers";

const t = setup();

describe("sync", () => {
  it("lets everything work with the server down afterwards", async () => {
    const c = t.client();
    const s = await c.sync({ images: true });
    expect([s.memes, s.stickers, s.images]).toEqual([2, 1, 1]);
    expect(s.requests).toBe(c.requestCount);
    t.fake.status = 500;
    const before = c.requestCount;
    expect((await c.meme("tang-ping")).title).toBe("躺平");
    expect((await c.persona())!.title).toBe("毒舌老哥");
    expect((await c.trending("", 1))[0]!.slug).toBe("tang-ping");
    expect((await c.searchStickers("震惊"))[0]!.id).toBe(STICKER);
    expect(existsSync(await c.stickerImage(STICKER))).toBe(true);
    expect(c.requestCount).toBe(before);
  });

  it("is free the second time", async () => {
    const c = t.client();
    await c.sync();
    expect((await c.sync()).requests).toBe(0);
  });

  it("skips missing scopes", async () => {
    t.fake.keys[KEY_B]!.scopes = ["memes:read"];
    expect((await t.client(KEY_B).sync()).memes).toBe(1);
  });

  it("skips a meme hidden since the list was read", async () => {
    const c = t.client();
    await c.searchMemes();
    delete t.fake.memes.yyds;
    expect((await c.sync()).memes).toBe(1);
  });
});
