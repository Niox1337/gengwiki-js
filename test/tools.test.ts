import { describe, expect, it } from "vitest";
import { KEY_A } from "./fake";
import { setup } from "./helpers";

const t = setup();

const parse = async (pending: Promise<string>) => JSON.parse(await pending);

describe("definitions and calls", () => {
  it("come in three formats", () => {
    const c = t.client();
    expect(new Set(c.tools.openai().map((d) => d.function.name))).toEqual(
      new Set(["search_memes", "get_meme", "trending_memes", "search_stickers", "search_people", "get_person", "search_lexicon"]),
    );
    expect(c.tools.openai()[0]!.type).toBe("function");
    const flat = c.tools.responses(["get_meme"])[0]!;
    expect([flat.type, flat.name]).toEqual(["function", "get_meme"]);
    const claude = c.tools.anthropic(["get_meme"]);
    expect(claude.map((d) => d.name)).toEqual(["get_meme"]);
    expect(claude[0]!.input_schema.properties).toHaveProperty("slug");
  });

  it("let the quote mode decide what the people tools return", async () => {
    const got = await parse(t.client().tools.call("search_people", { q: "树" }));
    expect([got[0].name, got[0].quotes]).toEqual(["鲁迅", ["我家门前有两棵树"]]);
    const off = t.client(KEY_A, { quotes: "off" }).tools;
    expect((await parse(off.call("search_people", { q: "鲁迅" })))[0]).not.toHaveProperty("quotes");
    expect(await parse(off.call("get_person", { name: "鲁迅" }))).not.toHaveProperty("quotes");
  });

  it("have a handler that runs for every definition", async () => {
    const c = t.client();
    const args: Record<string, string> = { q: "躺平", slug: "tang-ping", name: "鲁迅" };
    for (const d of c.tools.openai()) {
      const f = d.function;
      const call = Object.fromEntries((f.parameters.required ?? []).map((k) => [k, args[k]]));
      expect(await parse(c.tools.call(f.name, call)), f.name).not.toHaveProperty("error");
    }
  });

  it("reply trimmed and in readable Chinese", async () => {
    const text = await t.client().tools.call("search_memes", '{"q": "躺平"}');
    expect(text).toContain("躺平");
    expect(new Set(Object.keys(JSON.parse(text)[0]))).toEqual(new Set(["slug", "title", "aliases", "summary", "usage_scenario"]));
  });

  it("bring the scenario with a search, so no detail request", async () => {
    const c = t.client();
    for (const [name, args] of [["search_memes", { q: "躺平" }], ["trending_memes", {}]] as const) {
      expect((await parse(c.tools.call(name, args)))[0].usage_scenario, name).toBe("躺平的场景");
    }
    expect(t.fake.count("/v1/memes/tang-ping")).toBe(0);
  });

  it("leave an empty scenario out", async () => {
    t.fake.memes["tang-ping"]!.usage_scenario = "";
    const c = t.client();
    expect((await parse(c.tools.call("search_memes", { q: "躺平" })))[0]).not.toHaveProperty("usage_scenario");
    expect(await parse(c.tools.call("get_meme", { slug: "tang-ping" }))).not.toHaveProperty("usage_scenario");
  });

  it("give get_meme the full text", async () => {
    const got = await parse(t.client().tools.call("get_meme", { slug: "摆烂" }));
    expect([got.slug, got.body]).toEqual(["tang-ping", "躺平的正文"]);
  });

  it("take a limit sent as a string", async () => {
    expect(await parse(t.client().tools.call("trending_memes", { limit: "1" }))).toHaveLength(1);
  });

  it("return failures as JSON", async () => {
    const c = t.client();
    const cases: [string, any, string][] = [
      ["get_meme", { slug: "nope" }, "not_found"],
      ["no_such_tool", {}, "bad_arguments"],
      ["search_memes", "{not json", "bad_arguments"],
      ["search_memes", { wrong: 1 }, "bad_arguments"],
      ["search_memes", { q: "x", limit: "many" }, "bad_arguments"],
    ];
    for (const [name, args, code] of cases) expect((await parse(c.tools.call(name, args))).error.code, name).toBe(code);
    t.fake.keys[KEY_A]!.scopes = [];
    c.refresh();
    expect((await parse(c.tools.call("search_memes", { q: "x" }))).error.code).toBe("forbidden");
  });

  it("return arguments of the wrong type as JSON", async () => {
    const c = t.client();
    const cases: [string, any][] = [
      ["get_meme", { slug: 123 }],
      ["search_memes", { q: 5 }],
      ["search_memes", "null"],
      ["search_memes", "[1]"],
    ];
    for (const [name, args] of cases) expect((await parse(c.tools.call(name, args))).error.code).toBe("bad_arguments");
  });

  it("do not blame a 200 HTML page on the arguments", async () => {
    t.fake.htmlOk = true;
    expect((await parse(t.client().tools.call("search_memes", { q: "躺平" }))).error.code).toBe("bad_response");
  });

  it("cost the list and the hot board over a conversation", async () => {
    const c = t.client();
    for (const q of ["躺平", "永远的神", "上班味"]) await c.tools.call("search_memes", { q });
    expect(c.requestCount).toBe(2);
  });

  it("tell the model what to ask for on a near miss", async () => {
    const got = await parse(t.client().tools.call("get_meme", { slug: "躺平族" }));
    expect(got.error.code).toBe("not_found");
    expect(got.error.message).toContain("tang-ping");
  });
});

describe("run", () => {
  it("handles chat completions messages", async () => {
    const c = t.client();
    const message = { content: null, tool_calls: [{ id: "1", function: { name: "search_memes", arguments: '{"q": "躺平"}' } }] };
    const [reply] = await c.tools.run(message);
    expect([reply!.role, reply!.tool_call_id]).toEqual(["tool", "1"]);
    expect(reply!.content).toContain("tang-ping");
  });

  it("handles a whole chat completion", async () => {
    const call = { id: "1", function: { name: "search_memes", arguments: '{"q": "躺平"}' } };
    const [reply] = await t.client().tools.run({ choices: [{ message: { content: null, tool_calls: [call] } }] });
    expect(reply!.tool_call_id).toBe("1");
  });

  it("handles Claude messages", async () => {
    const message = { content: [{ type: "text", text: "查一下" }, { type: "tool_use", id: "t", name: "search_memes", input: { q: "躺平" } }] };
    const [reply] = await t.client().tools.run(message);
    expect(reply!.role).toBe("user");
    expect(reply!.content[0].tool_use_id).toBe("t");
    expect(reply!.content[0].content).toContain("tang-ping");
  });

  it("handles Responses API output", async () => {
    const c = t.client();
    const text = { type: "message", content: [] };
    const call = { type: "function_call", id: "fc", call_id: "c", name: "search_memes", arguments: '{"q": "躺平"}' };
    const [reply] = await c.tools.run({ output: [text, call] });
    expect([reply!.type, reply!.call_id]).toEqual(["function_call_output", "c"]);
    expect(reply!.output).toContain("tang-ping");
    expect(await c.tools.run({ output: [text] })).toEqual([]);
  });

  it("returns nothing when there are no calls", async () => {
    const c = t.client();
    expect(await c.tools.run({ content: "你好" })).toEqual([]);
    expect(await c.tools.run({ content: "你好", tool_calls: null })).toEqual([]);
  });
});
