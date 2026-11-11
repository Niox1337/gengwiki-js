import { afterEach, describe, expect, it, vi } from "vitest";
import { TTL_LIST, TTL_MISSING } from "../src/client";
import { AccountApiUnavailable, NotFoundError } from "../src/errors";
import { KEY_A, PERSONA_A, PERSONA_B } from "./fake";
import { setup } from "./helpers";

const t = setup();

afterEach(() => {
  vi.restoreAllMocks();
});

describe("persona", () => {
  it("is cached across clients", async () => {
    const p = (await t.client().persona())!;
    expect([p.id, p.title]).toEqual([PERSONA_A, "毒舌老哥"]);
    expect(p.asMessage()).toEqual({ role: "system", content: "你是毒舌老哥" });
    expect((await t.client().persona())!.prompt).toBe("你是毒舌老哥");
    expect(t.fake.count("/v1/persona")).toBe(1);
  });

  it("is null without one, and remembers that", async () => {
    t.fake.keys[KEY_A]!.persona = null;
    const c = t.client();
    expect(await c.persona()).toBeNull();
    expect(await c.persona()).toBeNull();
    expect(t.fake.count("/v1/persona")).toBe(1);
    expect(await t.client(null).persona()).toBeNull();
  });

  it("picks up an edit and a takedown with the list", async () => {
    const c = t.client();
    await c.persona();
    t.fake.personas[PERSONA_A]!.prompt = "改过了";
    expect((await c.persona())!.prompt).toBe("你是毒舌老哥");
    const start = Date.now();
    const at = (seconds: number) => vi.spyOn(Date, "now").mockReturnValue(start + seconds * 1000);
    at(TTL_LIST + 1);
    expect((await c.persona())!.prompt).toBe("改过了");
    const taken = t.fake.personas[PERSONA_A]!;
    delete t.fake.personas[PERSONA_A];
    at(2 * TTL_LIST + 2);
    expect(await c.persona()).toBeNull();
    t.fake.personas[PERSONA_A] = taken;
    at(2 * TTL_LIST + TTL_MISSING + 3);
    expect((await c.persona())!.prompt).toBe("改过了");
  });

  it("reads it again at once after refresh", async () => {
    const c = t.client();
    await c.persona();
    t.fake.personas[PERSONA_A]!.prompt = "改过了";
    c.refresh();
    expect((await c.persona())!.prompt).toBe("改过了");
  });
});

describe("personas", () => {
  it("searches the catalog locally", async () => {
    const c = t.client();
    expect((await c.personas()).map((p) => p.title)).toEqual(["毒舌老哥", "温柔姐姐"]);
    expect((await c.personas("温柔")).map((p) => p.id)).toEqual([PERSONA_B]);
    expect(t.fake.count("/api/personas")).toBe(1);
  });

  it("finds one row by id or title, and suggests close ones on a miss", async () => {
    const c = t.client();
    expect((await c.catalogRow(PERSONA_B)).title).toBe("温柔姐姐");
    expect((await c.catalogRow("毒舌老哥")).id).toBe(PERSONA_A);
    await expect(c.catalogRow("姐姐")).rejects.toThrow(/did you mean 温柔姐姐/);
  });

  it("falls back to the saved keys where the site hides the catalog", async () => {
    t.fake.accountOpen = false;
    const c = t.client();
    c.keyring.edit((d) => {
      d.keys.a = { key: KEY_A, persona_id: PERSONA_A, persona_title: "毒舌老哥" };
    });
    expect((await c.personas()).map((p) => p.title)).toEqual(["毒舌老哥"]);
    await expect(c.catalogRow("毒舌老哥")).rejects.toBeInstanceOf(AccountApiUnavailable);
    await expect(c.catalogRow("x")).rejects.not.toBeInstanceOf(NotFoundError);
  });
});
