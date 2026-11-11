import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError } from "../src/errors";
import { KEY_A, KEY_B, LU_XUN } from "./fake";
import { setup } from "./helpers";

const t = setup();
const names = (rows: { name: string }[]) => rows.map((p) => p.name);

describe("people", () => {
  it("links the ones on the key", async () => {
    const c = t.client();
    expect(names(await c.linkedPeople())).toEqual(["鲁迅"]);
    await c.linkedPeople();
    expect(t.fake.count("/v1/people/linked")).toBe(1);
    expect(await t.client(KEY_B).linkedPeople()).toEqual([]);
  });

  it("searches everyone locally and shares them between keys", async () => {
    const c = t.client();
    expect(new Set(names(await c.people()))).toEqual(new Set(["鲁迅", "杜甫"]));
    expect(names(await c.people("诗人"))).toEqual(["杜甫"]);
    expect(names(await c.people("两棵树"))).toEqual(["鲁迅"]);
    await t.client(KEY_B).people();
    expect(t.fake.count("/v1/people")).toBe(1);
  });

  it("walks every page", async () => {
    for (let i = 0; i < 150; i++) t.fake.people[`p${i}`] = { id: `p${i}`, name: `人${i}`, aliases: [], tags: [], bio: "", quotes: [] };
    expect(await t.client().people()).toHaveLength(152);
    expect(t.fake.count("/v1/people")).toBe(2);
  });

  it("finds one person by name, alias or id", async () => {
    const c = t.client();
    for (const wanted of ["鲁迅", "周树人", LU_XUN]) {
      const p = await c.person(wanted);
      expect([p.name, p.memes[0]!.slug]).toEqual(["鲁迅", "tang-ping"]);
    }
    await expect(c.person("没有这个人")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("needs the scope", async () => {
    t.fake.keys[KEY_A]!.scopes = ["memes:read"];
    await expect(t.client().linkedPeople()).rejects.toBeInstanceOf(ForbiddenError);
  });
});
