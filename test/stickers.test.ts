import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { BadResponseError, NotFoundError } from "../src/errors";
import { PACK, PNG, STICKER } from "./fake";
import { setup } from "./helpers";

const t = setup();

describe("stickers", () => {
  it("searches locally", async () => {
    const c = t.client();
    const s = (await c.searchStickers("震惊"))[0]!;
    expect([s.id, s.pack_id, s.pack_title]).toEqual([STICKER, PACK, "猫猫"]);
    expect(s.url.endsWith(`/v1/stickers/${STICKER}/image`)).toBe(true);
    expect(await c.searchStickers("可爱")).toHaveLength(1);
    expect(await c.searchStickers("没有")).toEqual([]);
    expect((await c.stickerPacks())[0]!.stickers[0]!.caption).toBe("震惊");
    expect(c.requestCount).toBe(1);
  });

  it("downloads an image once and without a key", async () => {
    const c = t.client(null);
    const path = await c.stickerImage(STICKER);
    expect(readFileSync(path)).toEqual(PNG);
    expect(extname(path)).toBe(".png");
    expect(await t.client().stickerImage(STICKER.toUpperCase())).toBe(path);
    expect(t.fake.count("/v1/stickers/")).toBe(1);
  });

  it("never lets an id escape the folder", async () => {
    await expect(t.client().stickerImage("../../keys")).rejects.toBeInstanceOf(TypeError);
    expect(t.fake.count()).toBe(0);
  });

  it("never keeps a 200 in HTML as an image", async () => {
    const c = t.client();
    t.fake.htmlOk = true;
    await expect(c.stickerImage(STICKER)).rejects.toBeInstanceOf(BadResponseError);
    expect(existsSync(join(c.home, "stickers"))).toBe(false);
    t.fake.htmlOk = false;
    expect(readFileSync(await c.stickerImage(STICKER))).toEqual(PNG);
  });

  it("raises on a missing image", async () => {
    await expect(t.client().stickerImage("00000000-0000-0000-0000-000000000000")).rejects.toBeInstanceOf(NotFoundError);
  });
});
