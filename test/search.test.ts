import { describe, expect, it } from "vitest";
import { type Row, matchMemes, searchEntries, searchMemes, searchStickers, similarity } from "../src/search";

const row = (title: string, aliases: string[] = [], heat = 0) => ({ slug: title, title, aliases, heat });
const titles = (rows: Row[]) => rows.map((r) => r.title);

describe("search", () => {
  it("searches the scenario without letting it outrank a name", () => {
    const rows = [{ ...row("牛马", [], 1), usage_scenario: "加班到深夜时" }, row("加班狗")];
    expect(titles(searchMemes("加班", rows, 5))).toEqual(["加班狗", "牛马"]);
  });

  it("finds the names written in a text", () => {
    const rows = [row("躺平", ["摆烂"], 1), row("YYDS", [], 9), row("班味", ["班"], 5)];
    expect(titles(matchMemes("今天彻底摆烂了，yyds", rows, 5))).toEqual(["YYDS", "躺平"]);
    // a one character alias does not count
    expect(matchMemes("上班好累", rows, 5)).toEqual([]);
  });

  it("scores like pg_trgm", () => {
    // select similarity('word', 'two words') is 0.363636 in Postgres.
    expect(similarity("word", "two words")).toBeCloseTo(4 / 11);
    expect(similarity("", "x")).toBe(0);
  });

  it("matches a substring literally and without case", () => {
    const rows = [row("YYDS", ["永远的神"]), row("100%真实")];
    expect(titles(searchMemes("yyds", rows, 5))).toEqual(["YYDS"]);
    expect(titles(searchMemes("永远", rows, 5))).toEqual(["YYDS"]);
    expect(titles(searchMemes("0%", rows, 5))).toEqual(["100%真实"]);
    expect(searchMemes("不存在的词", rows, 5)).toEqual([]);
  });

  it("orders by similarity, then heat", () => {
    const rows = [row("躺平青年", [], 99), row("躺平", [], 1), row("躺平", [], 5)];
    expect(searchMemes("躺平", rows, 5).map((r) => r.heat)).toEqual([5, 1, 99]);
  });

  it("keeps the server's order and the limit for an empty query", () => {
    const rows = [row("a", [], 2), row("b", [], 1)];
    expect(searchMemes(" ", rows, 1)).toEqual(rows.slice(0, 1));
  });

  it("matches stickers by caption, pack title and pack tag", () => {
    const packs = [{ id: "p", title: "猫猫", tags: ["可爱"], stickers: [{ id: "s", caption: "震惊", url: "u" }] }];
    for (const q of ["震惊", "猫", "可爱"]) expect(searchStickers(q, packs, 5)[0]!.pack_id).toBe("p");
    expect(searchStickers("狗", packs, 5)).toEqual([]);
  });

  it("puts a sticker asked for by caption before the rest of its matches", () => {
    const sticker = (caption: string) => ({ id: caption, caption, url: "u" });
    const packs = [
      { id: "a", title: "笑", tags: [], stickers: [sticker("哭")] },
      { id: "b", title: "猫", tags: [], stickers: [sticker("笑哭"), sticker("笑"), sticker("大笑\n不止")] },
    ];
    expect(searchStickers("笑", packs, 5).map((s) => s.id)).toEqual(["笑", "笑哭", "大笑\n不止", "哭"]);
    expect(searchStickers(" 大笑  不止 ", packs, 1)[0]!.id).toBe("大笑\n不止");
    expect(searchStickers("", packs, 5).map((s) => s.id)).toEqual(["哭", "笑哭", "笑", "大笑\n不止"]);
  });

  it("searches lexicon entries by alias", () => {
    const e = [{ term: "摆烂", aliases: ["bailan"], note: "", tags: [] }];
    expect(searchEntries("BAILAN", e, 5)).toEqual(e);
  });
});
