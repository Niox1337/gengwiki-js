import { describe, expect, it } from "vitest";
import { toMeme, toPersona, toStickerPack } from "../src/models";

describe("models", () => {
  it("drops unknown fields and fills defaults", () => {
    const m = toMeme({ slug: "x", title: "X", brand_new_field: 1, related: [{ slug: "y", extra: true }] });
    expect(m).not.toHaveProperty("brand_new_field");
    expect(m.aliases).toEqual([]);
    expect(m.related[0]).toEqual(expect.objectContaining({ slug: "y", heat: 0 }));
    expect(m.related[0]).not.toHaveProperty("extra");
  });

  it("gives a persona its system message and keeps it plain data", () => {
    const p = toPersona({ id: "1", title: "猫", prompt: "你是猫" });
    expect(p.asMessage()).toEqual({ role: "system", content: "你是猫" });
    expect(JSON.parse(JSON.stringify(p))).not.toHaveProperty("asMessage");
  });

  it("stamps each sticker with its pack", () => {
    const pack = toStickerPack({ id: "p", title: "猫猫", stickers: [{ id: "s", caption: "震惊" }] });
    expect(pack.stickers[0]).toEqual({ id: "s", caption: "震惊", url: "", pack_id: "p", pack_title: "猫猫" });
  });
});
