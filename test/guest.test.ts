import { beforeEach, describe, expect, it } from "vitest";
import { AuthError } from "../src/errors";
import { KEY_A, meme } from "./fake";
import { setup } from "./helpers";

const t = setup();

describe("without a key", () => {
  beforeEach(() => {
    for (let i = 0; i < 25; i++) {
      const m = meme(`m${i}`, `梗${i}`, 100 - i);
      t.fake.memes[m.slug] = m;
    }
    for (let i = 0; i < 12; i++) {
      const pid = `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`;
      t.fake.people[pid] = { id: pid, name: `人${i}`, aliases: [], tags: [], bio: "", quotes: [`语录${i}`] };
    }
  });

  it("reads the hot board and ten people", async () => {
    const c = t.client(null);
    expect(await c.searchMemes()).toHaveLength(20);
    expect(await c.trending()).toHaveLength(20);
    expect(await c.people()).toHaveLength(10);
    expect(await c.linkedPeople()).toHaveLength(10);
    expect(await c.persona()).toBeNull();
    await expect(c.usage()).rejects.toThrow(AuthError);
  });

  it("never hands a guest copy to a keyed client", async () => {
    await t.client(null).people();
    expect(await t.client(KEY_A).people()).toHaveLength(14);
  });

  it("keeps memes out with guestMemes false", async () => {
    const c = t.client(null, { guestMemes: false });
    expect(await c.matchMemes("躺平")).toEqual([]);
    expect(await c.memePrompt("躺平")).toBe("");
    expect(await c.explain("躺平是什么梗")).toBe("");
    expect(await t.client(null).memePrompt("躺平")).toContain("<memes>");
  });
});
