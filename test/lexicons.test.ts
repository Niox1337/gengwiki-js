import { describe, expect, it } from "vitest";
import { ForbiddenError } from "../src/errors";
import { KEY_A } from "./fake";
import { setup } from "./helpers";

const t = setup();

describe("lexicons", () => {
  it("updates the cache on a write without reading again", async () => {
    const c = t.client();
    expect(await c.lexicons()).toEqual([]);
    const lex = await c.createLexicon("我的词库", "说明");
    expect((await c.lexicons())[0]!.name).toBe("我的词库");
    expect(await c.lexiconEntries(lex.id)).toEqual([]);
    const e = await c.addLexiconEntry(lex.id, "摆烂", { aliases: ["bailan"], note: "不想努力了" });
    expect(await c.lexiconEntries(lex.id)).toEqual([e]);
    expect((await c.lexicons())[0]!.entries).toBe(1);
    expect(await c.searchLexicons("BAILAN")).toEqual([e]);
    expect(await c.searchLexicons("没有")).toEqual([]);
    // 2 reads, 2 writes
    expect(t.fake.count("/v1/me/lexicons")).toBe(4);
  });

  it("refuses a write without the scope", async () => {
    t.fake.keys[KEY_A]!.scopes = ["lexicon:read:self"];
    await expect(t.client().createLexicon("x")).rejects.toBeInstanceOf(ForbiddenError);
  });
});
