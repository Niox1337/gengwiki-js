import { describe, expect, it } from "vitest";
import { type Io, main } from "../src/cli";
import { GengWiki } from "../src/client";
import { KEY_A, KEY_B } from "./fake";
import { setup } from "./helpers";

const t = setup();

interface RunOptions {
  key?: string;
  password?: string;
  secret?: string;
}

async function run(argv: string[], { key = "", password = "correct horse", secret = KEY_A }: RunOptions = {}): Promise<[number, string]> {
  const env = { GENGWIKI_API_URL: t.url, GENGWIKI_SITE_URL: t.url, GENGWIKI_HOME: t.dir, GENGWIKI_API_KEY: key };
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  const lines: string[] = [];
  const io: Io = {
    out: (text) => lines.push(text),
    err: (text) => lines.push(text),
    ask: async () => "me@example.com",
    secret: async (prompt) => (prompt.includes("密码") ? password : secret),
  };
  try {
    return [await main(argv, io), lines.join("\n")];
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const text = async (...argv: string[]) => (await run(argv))[1];

describe("command line", () => {
  it("goes from nothing to a search on the first run", async () => {
    const [code, out] = await run(["status"]);
    expect(code).toBe(0);
    expect(out).toContain("/me");
    expect((await run(["keys", "add", "老哥"]))[0]).toBe(0);
    const [searched, found] = await run(["search", "躺平"]);
    expect(searched).toBe(0);
    expect(found).toContain("tang-ping");
    expect(await text("keys")).toContain("* 老哥");
    expect(await text("status")).toContain("毒舌老哥");
  });

  it("says what the key can do", async () => {
    await run(["keys", "add", "老哥"]);
    expect(await text("status")).toContain("梗 2 个，表情");
    t.fake.keys[KEY_A]!.scopes = ["memes:read"];
    const c = new GengWiki({ apiKey: KEY_A, baseUrl: t.url, siteUrl: t.url, home: t.dir });
    c.refresh();
    c.close();
    const [code, out] = await run(["status"]);
    expect(code).toBe(0);
    expect(out).toContain("缺权限");
    expect(out).toContain("people:read");
  });

  it("shows the key only when asked", async () => {
    await run(["keys", "add", "老哥"]);
    for (const argv of [["keys"], ["status"], ["search", "躺平"]]) expect(await text(...argv), argv.join(" ")).not.toContain(KEY_A);
    expect((await text("keys", "secret", "老哥")).trim()).toBe(KEY_A);
  });

  it("switches keys and personas", async () => {
    await run(["keys", "add", "a"]);
    await run(["keys", "add", "b"], { secret: KEY_B });
    expect((await run(["use", "温柔姐姐"]))[0]).toBe(0);
    expect(await text("status")).toContain("温柔姐姐");
    expect((await run(["keys", "use", "a"]))[0]).toBe(0);
    expect(await text("status")).toContain("毒舌老哥");
    expect(await text("keys")).toContain("* a");
  });

  it("logs in and runs the account commands", async () => {
    expect((await run(["login"]))[0]).toBe(0);
    expect(await text("keys", "remote")).toContain("gwk_live_aaaaaa");
    await run(["keys", "add", "a"]);
    expect((await run(["keys", "rotate", "a"]))[0]).toBe(0);
    expect((await run(["keys", "revoke", "a"]))[0]).toBe(0);
    expect((await run(["keys", "remove", "a"]))[0]).toBe(0);
    expect((await run(["logout"]))[0]).toBe(0);
  });

  it("prints a message and exits 1 on a failure", async () => {
    for (const [argv, expected] of [
      [["login"], "unauthorized"],
      [["keys", "use", "nope"], "no key saved"],
      [["keys", "secret", "nope"], "no key saved"],
    ] as const) {
      const [code, out] = await run([...argv], { password: "wrong" });
      expect(code, argv.join(" ")).toBe(1);
      expect(out).toContain(expected);
    }
    expect((await run(["keys", "add", "x"], { secret: "sk-not-ours" }))[0]).toBe(1);
    expect((await run(["meme"]))[0]).toBe(1);
  });

  it("reads and syncs", async () => {
    await run(["keys", "add", "a"]);
    expect(await text("meme", "摆烂")).toContain("躺平的正文");
    expect(await text("meme", "摆烂")).toContain("躺平的场景");
    expect(await text("trending")).toContain("tang-ping");
    expect(await text("tags")).toContain("网络  2");
    expect(await text("subscribe")).toContain("还没有订阅");
    expect(await text("subscribe", "网络")).toContain("tang-ping");
    expect(await text("subscribe")).toContain("网络");
    expect(await text("unsubscribe", "网络")).toContain("已退订");
    expect(await text("unsubscribe", "网络")).toContain("没有订阅");
    expect(await text("personas", "姐姐")).toContain("温柔姐姐");
    expect(await text("sync", "--images")).toContain("梗 2 个");
  });

  it("says so when nothing is found", async () => {
    await run(["keys", "add", "a"]);
    expect(await text("search", "完全不存在")).toContain("没有找到");
    expect(await text("personas", "完全不存在")).toContain("没有找到");
  });

  it("prints help with no command and refuses an unknown one", async () => {
    const [code, out] = await run([]);
    expect(code).toBe(0);
    expect(out).toContain("usage");
    expect(out).toContain("梗Wiki");
    expect((await run(["nope"]))[0]).toBe(2);
    expect((await run(["keys", "nope"]))[0]).toBe(2);
    expect((await run(["status", "--nope"]))[0]).toBe(2);
    expect(await text("--version")).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
