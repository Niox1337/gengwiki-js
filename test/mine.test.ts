import { describe, expect, it } from "vitest";
import { AuthError } from "../src/errors";
import { PNG } from "./fake";
import { setup } from "./helpers";

const t = setup();

describe("my words, stickers, personas and people", () => {
  it("adds and removes each kind", async () => {
    const c = t.client();
    expect((await c.addWord("绝绝子", "很绝")).term).toBe("绝绝子");
    expect((await c.addSticker(PNG, "开心")).pack_title).toBe("我的表情包");
    expect((await c.addPersona("小猫", "你是一只猫")).title).toBe("小猫");
    expect((await c.addPerson("张三", "群主", ["收到"])).name).toBe("张三");
    const removed = [await c.removeWord("绝绝子"), await c.removeSticker("开心"), await c.removePersona("小猫"), await c.removePerson("张三")];
    expect(removed).toEqual([1, 1, 1, 1]);
    expect(await c.removeWord("绝绝子")).toBe(0);
  });

  it("makes the next read refetch after a write", async () => {
    const c = t.client();
    await c.stickerPacks();
    const before = c.requestCount;
    await c.addSticker(PNG, "开心");
    await c.stickerPacks();
    expect(c.requestCount).toBe(before + 2);
  });

  it("needs a key to write", async () => {
    await expect(t.client(null).addWord("绝绝子")).rejects.toThrow(AuthError);
  });
});

describe("without a key", () => {
  it("rejects the promise rather than throwing", async () => {
    const c = t.client(null);
    const pending = c.lexicons();
    expect(pending).toBeInstanceOf(Promise);
    await expect(pending).rejects.toThrow(AuthError);
  });
});
