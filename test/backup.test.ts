import { beforeEach, describe, expect, it } from "vitest";
import { setup } from "./helpers";

const t = setup();

beforeEach(() => {
  t.fake.backup = [
    { slug: "x", title: "哈基米", aliases: ["hjm"], summary: "来源 出自\n赛马娘<b>", keywords: [] },
    { slug: "y", title: "哈基米南北绿豆", aliases: [], summary: "一首歌" },
  ];
});

const client = (options = {}) => t.client(undefined, { backupUrl: `${t.url}/backup`, ...options });

describe("backup wiki", () => {
  it("takes exact matches only, cleaned, and caches them", async () => {
    const c = client();
    const found = await c.backupMemes("哈基米");
    expect(found.map((m) => [m.title, m.slug, m.summary])).toEqual([["哈基米", "", "出自 赛马娘＜b>"]]);
    expect((await c.backupMemes("HJM")).map((m) => m.title)).toEqual(["哈基米"]);
    await c.backupMemes("哈基米");
    expect(await c.backupMemes("没有这个")).toEqual([]);
    await c.backupMemes("没有这个");
    // a miss is kept too
    expect(t.fake.count("/backup")).toBe(3);
  });

  it("answers nothing during an outage and pauses", async () => {
    const c = client();
    t.fake.status = 500;
    expect(await c.backupMemes("哈基米")).toEqual([]);
    t.fake.status = null;
    expect(await c.backupMemes("哈基米")).toEqual([]);
    expect(t.fake.count("/backup")).toBe(1);
  });

  it("lets explain answer a question about a meme", async () => {
    const c = client();
    expect(await c.explain("请问“躺平”是什么梗啊")).toContain("- 躺平（摆烂）：");
    expect(await c.explain("哈基米这个梗啥意思")).toContain("- 哈基米（hjm）：出自 赛马娘");
    for (const text of ["这是什么梗", "今天好累", "最近流行什么梗"]) expect(await c.explain(text)).toBe("");
    // or the model explains from memory
    expect(await c.explain("没有这个是什么梗")).toContain("没有资料，不用再搜它");
    expect(t.fake.count("/backup")).toBe(2);
  });

  it("keeps every word here with backup off", async () => {
    const c = client({ backup: false });
    expect(await c.explain("哈基米是什么梗")).toContain("没有资料");
    expect(t.fake.count("/backup")).toBe(0);
  });
});
