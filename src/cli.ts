/** The command line. Mostly for first-time setup, so a password or key never has to sit in a script or shell history. */

import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { GengWiki } from "./client";
import { GengWikiError } from "./errors";
import type { MemeSummary } from "./models";
import { VERSION } from "./version";

/** Where the command line reads and writes. Replaceable for tests. */
export interface Io {
  out(text: string): void;
  err(text: string): void;
  /** One line typed in the open. */
  ask(prompt: string): Promise<string>;
  /** One line typed with no echo. */
  secret(prompt: string): Promise<string>;
}

/** Ctrl-C or the end of input while a prompt waits. */
class Interrupted extends Error {}

interface Args {
  positionals: string[];
  images: boolean;
}

type Command = (c: GengWiki, a: Args, io: Io) => Promise<void> | void;

const memes = (io: Io, rows: MemeSummary[]) => {
  if (!rows.length) io.out("没有找到");
  for (const m of rows) io.out(`${m.title}  [${m.slug}]  ${m.summary}`);
};

const arg = (a: Args, i: number, name: string): string => {
  const value = a.positionals[i];
  if (value === undefined) throw new TypeError(`缺少参数 ${name}`);
  return value;
};

const COMMANDS: Record<string, Command> = {
  async status(c, _a, io) {
    io.out(`站点  ${c.baseUrl}`);
    io.out(`登录  ${c.keys.loggedIn ? "已登录" : "未登录"}`);
    if (!c.key) {
      io.out(`Key   没有，现在只能用热门的 20 个梗和 10 个人物。到 ${c.siteUrl}/me 创建后运行 gengwiki keys add 名字`);
      return;
    }
    const saved = c.keys.local().find((k) => k.current);
    io.out(`Key   ${saved ? saved.name : "来自参数或环境变量"}  ${c.key.slice(0, 15)}`);
    const s = await c.status();
    io.out(`人设  ${s.persona || "没有"}`);
    io.out(`内容  梗 ${s.memes} 个，表情 ${s.stickers} 张，人物 ${s.people} 个，语录 ${s.quotes} 句`);
    if (s.missing.length) io.out(`缺权限  ${s.missing.join("、")}，到 ${c.siteUrl}/me 新建一个勾选它们的 Key`);
    if (s.stale) io.out("数据  暂时连不上梗Wiki，这是旧数据");
    try {
      const r = await c.rateLimit();
      io.out(`额度  今天 ${r.used_today}/${r.per_day}，这一分钟 ${r.used_this_minute}/${r.per_minute}`);
    } catch (e) {
      if (!(e instanceof GengWikiError)) throw e;
      io.out(`额度  暂时查不到，${e.message}`);
    }
  },
  async login(c, a, io) {
    const email = a.positionals[1] || (await io.ask("邮箱 "));
    const user = await c.keys.login(email, await io.secret("密码 "));
    io.out(`已登录 ${user.email ?? ""}，7 天内有效，密码没有保存`);
  },
  logout(c, _a, io) {
    c.keys.logout();
    io.out("已退出");
  },
  async search(c, a, io) {
    memes(io, await c.findMemes(a.positionals[1] ?? ""));
  },
  async meme(c, a, io) {
    const m = await c.meme(arg(a, 1, "slug"));
    io.out(m.title);
    if (m.aliases.length) io.out(`别名  ${m.aliases.join("、")}`);
    io.out(`\n${m.body || m.summary}`);
    if (m.usage_scenario) io.out(`\n使用场景  ${m.usage_scenario}`);
    for (const example of m.usage_examples) io.out(`\n  ${example}`);
  },
  async trending(c, a, io) {
    memes(io, await c.trending(a.positionals[1] ?? ""));
  },
  async tags(c, _a, io) {
    for (const t of await c.tags()) io.out(`${t.name}  ${t.count}`);
  },
  async subscribe(c, a, io) {
    const tag = a.positionals[1];
    if (!tag) {
      io.out(c.subscriptions().join("、") || "还没有订阅标签");
      return;
    }
    const rows = await c.subscribe(tag);
    io.out(`已订阅 ${tag}`);
    memes(io, rows);
  },
  async unsubscribe(c, a, io) {
    const tag = arg(a, 1, "tag");
    io.out((await c.unsubscribe(tag)) ? `已退订 ${tag}` : `没有订阅 ${tag}`);
  },
  async personas(c, a, io) {
    const rows = await c.personas(a.positionals[1] ?? "");
    if (!rows.length) io.out("没有找到");
    for (const p of rows) io.out(`${p.title}  ${p.description}`.trimEnd());
  },
  async use(c, a, io) {
    io.out(`已切换到 ${(await c.usePersona(arg(a, 1, "persona"))).title}`);
  },
  async sync(c, a, io) {
    const s = await c.sync({ images: a.images });
    io.out(`梗 ${s.memes} 个，表情 ${s.stickers} 个，图片 ${s.images} 张，发出 ${s.requests} 个请求`);
  },
};

const HELP: [string, string][] = [
  ["status", "当前站点、Key、人设、内容、缺的权限和额度"],
  ["login [邮箱]", "登录以管理 Key"],
  ["logout", "退出登录"],
  ["search [关键词]", "搜索梗"],
  ["meme <slug>", "查看一个梗"],
  ["trending [标签]", "热门榜"],
  ["tags", "全部标签"],
  ["subscribe [标签]", "订阅标签，不带标签时列出已订阅的"],
  ["unsubscribe <标签>", "退订标签"],
  ["personas [关键词]", "浏览人设"],
  ["use <人设>", "切换人设"],
  ["sync [--images]", "下载全部内容供离线使用"],
  ["keys", "列出已保存的 Key"],
  ["keys add <名字>", "保存在网站上创建的 Key"],
  ["keys use <名字>", "切换到已保存的 Key"],
  ["keys remove <名字>", "只从本机删除"],
  ["keys secret <名字>", "输出密钥，交给别的程序"],
  ["keys remote", "列出账号上的 Key，需要登录"],
  ["keys rotate <名字>", "换新密钥，需要登录"],
  ["keys revoke <名字>", "吊销并从本机删除，需要登录"],
];

const KEYS: Record<string, Command> = {
  local(c, _a, io) {
    const rows = c.keys.local();
    if (!rows.length) io.out(`还没有保存 Key，到 ${c.siteUrl}/me 创建后运行 gengwiki keys add 名字`);
    for (const k of rows) io.out(`${k.current ? "*" : " "} ${k.name}  ${k.prefix}  ${k.persona_title ?? ""}`.trimEnd());
  },
  async add(c, a, io) {
    const name = arg(a, 2, "名字");
    io.out(`已保存 ${c.keys.add(name, (await io.secret("粘贴 Key ")).trim()).name}`);
  },
  use(c, a, io) {
    io.out(`已切换到 ${c.keys.use(arg(a, 2, "名字")).name}`);
  },
  remove(c, a, io) {
    const name = arg(a, 2, "名字");
    c.keys.remove(name);
    io.out(`已从本机删除 ${name}，服务器上依然有效`);
  },
  secret(c, a, io) {
    io.out(c.keys.secret(arg(a, 2, "名字")));
  },
  async remote(c, _a, io) {
    for (const k of await c.keys.list()) io.out(`${k.name}  ${k.prefix}  最后使用 ${k.last_used_at ?? "从未"}`);
  },
  async rotate(c, a, io) {
    io.out(`已换新密钥并保存到 ${(await c.keys.rotate(arg(a, 2, "名字"))).name}，旧密钥立即失效`);
  },
  async revoke(c, a, io) {
    const name = arg(a, 2, "名字");
    await c.keys.revoke(name);
    io.out(`已吊销 ${name}`);
  },
};

function help(): string {
  const width = Math.max(...HELP.map(([usage]) => usage.length));
  const rows = HELP.map(([usage, text]) => `  ${usage.padEnd(width + 2)}${text}`);
  return ["usage: gengwiki <命令> [参数]", "", "梗Wiki 命令行", "", "命令:", ...rows, "", "  --version      版本号", "  -h, --help     本帮助"].join("\n");
}

/** Runs one command and returns the exit code. */
export async function main(argv: string[], io: Io = terminal()): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { images: { type: "boolean", default: false }, version: { type: "boolean" }, help: { type: "boolean", short: "h" } },
    });
  } catch (e) {
    io.err(`错误  ${(e as Error).message}`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.version) {
    io.out(VERSION);
    return 0;
  }
  const name = positionals[0];
  if (values.help || name === undefined) {
    io.out(help());
    return 0;
  }
  const run = name === "keys" ? KEYS[positionals[1] ?? "local"] : COMMANDS[name];
  if (!run) {
    io.err(`错误  没有这个命令 ${name === "keys" ? `keys ${positionals[1]}` : name}，运行 gengwiki --help 查看全部命令`);
    return 2;
  }
  const client = new GengWiki();
  try {
    await run(client, { positionals, images: values.images ?? false }, io);
  } catch (e) {
    if (e instanceof Interrupted) return 130;
    if (e instanceof GengWikiError || e instanceof TypeError) {
      io.err(`错误  ${e.message}`);
      return 1;
    }
    throw e;
  } finally {
    client.close();
  }
  return 0;
}

/** The real terminal. A secret is read with the echo off when stdin is a terminal. */
export function terminal(): Io {
  let lines: AsyncIterator<string> | null = null;
  const next = async (prompt: string): Promise<string> => {
    process.stdout.write(prompt);
    lines ??= createInterface({ input: process.stdin, terminal: false })[Symbol.asyncIterator]();
    const { value, done } = await lines.next();
    if (done) throw new Interrupted();
    return value;
  };
  return {
    out: (text) => process.stdout.write(`${text}\n`),
    err: (text) => process.stderr.write(`${text}\n`),
    ask: next,
    secret(prompt) {
      const { stdin, stdout } = process;
      if (!stdin.isTTY) return next(prompt);
      stdout.write(prompt);
      return new Promise((resolve, reject) => {
        let typed: string[] = [];
        const finish = () => {
          stdin.off("data", onData);
          stdin.setRawMode(false);
          stdin.pause();
          stdout.write("\n");
        };
        const onData = (chunk: string) => {
          for (const ch of chunk) {
            if (ch === "\r" || ch === "\n") {
              finish();
              return resolve(typed.join(""));
            }
            if (ch === "\u0003" || ch === "\u0004") {
              finish();
              return reject(new Interrupted());
            }
            if (ch === "\u007f" || ch === "\b") typed = typed.slice(0, -1);
            else typed.push(ch);
          }
        };
        stdin.setRawMode(true);
        stdin.setEncoding("utf8");
        stdin.resume();
        stdin.on("data", onData);
      });
    },
  };
}
