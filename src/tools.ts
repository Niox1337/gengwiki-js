/** Tools for function calling, in OpenAI or Anthropic format. Replies are trimmed, because every field costs the model tokens. */

import type { GengWiki } from "./client";
import { GengWikiError, NotFoundError } from "./errors";
import { type MemeSummary, type Person, toMemeSummary } from "./models";
import type { Row } from "./search";

type Kind = "string" | "integer" | "strings";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: "string" | "integer"; description: string }>;
    required?: string[];
  };
}

const LIMIT = { type: "integer", description: "返回条数" } as const;

const DEFINITIONS: ToolDefinition[] = [
  {
    name: "search_memes",
    description: "搜索中文网络热梗，返回释义和使用场景。遇到不认识的网络用语时调用。",
    parameters: {
      type: "object",
      properties: { q: { type: "string", description: "梗的关键词、别名、拼音缩写，或者一个场景，比如加班" }, limit: LIMIT },
      required: ["q"],
    },
  },
  {
    name: "get_meme",
    description: "查看一个梗的完整解释和用法例句。搜索结果的释义和使用场景不够用时调用。",
    parameters: {
      type: "object",
      properties: { slug: { type: "string", description: "search_memes 返回的 slug，也可以是梗的准确名称" } },
      required: ["slug"],
    },
  },
  {
    name: "trending_memes",
    description: "查看全站最近流行的梗。想了解现在流行什么时调用。",
    parameters: {
      type: "object",
      properties: { tag: { type: "string", description: "分类，留空为全站榜" }, limit: LIMIT },
    },
  },
  {
    name: "search_stickers",
    description: "按说明文字搜索表情包，返回图片链接。只做文字匹配，不懂近义词。链接可以直接放进 Markdown。",
    parameters: {
      type: "object",
      properties: { q: { type: "string", description: "表情说明里的词" }, limit: LIMIT },
      required: ["q"],
    },
  },
  {
    name: "search_people",
    description: "搜索收录的人物，返回简介，语录是否返回由设置决定。问到某个人是谁，或者想知道一句话是谁说的时调用。",
    parameters: {
      type: "object",
      properties: { q: { type: "string", description: "名字、别名、标签，或者语录里的词" }, limit: LIMIT },
      required: ["q"],
    },
  },
  {
    name: "get_person",
    description: "查看一个人物的完整简介、全部语录和提到这个人物的梗。搜索结果不够用时调用。",
    parameters: {
      type: "object",
      properties: { name: { type: "string", description: "准确的名字或别名" } },
      required: ["name"],
    },
  },
  {
    name: "search_lexicon",
    description: "搜索用户的个人词库，里面是用户自己记录的词语和含义。用户问自己记过的词时调用，和梗百科说法不同时以用户的记录为准。",
    parameters: {
      type: "object",
      properties: { q: { type: "string", description: "关键词" }, limit: LIMIT },
      required: ["q"],
    },
  },
];

/** Arguments a host may pass that the model never sees. */
const HIDDEN: Record<string, Record<string, Kind>> = {
  search_memes: { tags: "strings" },
  get_meme: { tags: "strings" },
};

/** What a search result holds per person. */
const PROMPT_BIO = 200;

/** First n characters, counted as code points. */
const cut = (text: string, n?: number): string => (n === undefined ? text : Array.from(text).slice(0, n).join(""));

function summary(m: MemeSummary): Row {
  const row: Row = m.slug ? { slug: m.slug } : {};
  // A row without a slug came from the backup wiki, get_meme has nothing more on it.
  Object.assign(row, { title: m.title, aliases: m.aliases, summary: m.summary });
  // Most memes have none yet, and an empty field still costs tokens.
  if (m.usage_scenario) row.usage_scenario = m.usage_scenario;
  return row;
}

/** The arguments as an object with the declared types. Throws TypeError for anything else. */
function checkArgs(name: string, raw: unknown): Record<string, any> {
  const def = DEFINITIONS.find((d) => d.name === name);
  if (!def) throw new TypeError(`unknown tool ${JSON.stringify(name)}`);
  let args = typeof raw === "string" ? JSON.parse(raw || "{}") : (raw ?? {});
  if (typeof args !== "object" || args === null || Array.isArray(args)) throw new TypeError("arguments must be a JSON object");
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(args)) {
    const kind = def.parameters.properties[key]?.type ?? HIDDEN[name]?.[key];
    if (!kind) throw new TypeError(`unexpected argument ${JSON.stringify(key)}`);
    out[key] = coerce(key, kind, value);
  }
  for (const key of def.parameters.required ?? []) {
    if (out[key] === undefined) throw new TypeError(`missing argument ${JSON.stringify(key)}`);
  }
  return out;
}

function coerce(key: string, kind: Kind, value: unknown): unknown {
  if (kind === "string") {
    if (typeof value !== "string") throw new TypeError(`${key} must be a string`);
    return value;
  }
  if (kind === "integer") {
    // Models often send numbers as strings.
    if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
    if (typeof value === "string" && /^\s*[+-]?\d+\s*$/.test(value)) return Number.parseInt(value, 10);
    throw new TypeError(`${key} must be an integer`);
  }
  if (value === null || value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) throw new TypeError(`${key} must be a list of strings`);
  return value;
}

type Handler = (args: Record<string, any>) => Promise<unknown>;

function handlers(c: GengWiki): Record<string, Handler> {
  const person = (p: Person, bio?: number, quotes?: number): Row => {
    const row: Row = { name: p.name, aliases: p.aliases, tags: p.tags, bio: cut(p.bio, bio) };
    if (c.quotes !== "off" && p.quotes.length) row.quotes = p.quotes.slice(0, quotes);
    return row;
  };

  return {
    async search_memes({ q, limit = 5, tags }) {
      let found = await c.findMemes(q, limit, { tags });
      if (!found.length && c.backup) found = await c.backupMemes(q, limit);
      return found.map(summary);
    },

    async get_meme({ slug, tags }) {
      let m;
      try {
        m = await c.meme(slug);
      } catch (e) {
        if (!(e instanceof NotFoundError)) throw e;
        // search_memes also finds what this key may not read in full, the summary is all there is of those.
        const wanted = slug.trim().toLowerCase();
        const row = (await c.pool(tags)).find(
          (r) => r.slug === slug || [r.title, ...r.aliases].some((s: string) => s.toLowerCase() === wanted),
        );
        if (!row) {
          const backup = c.backup ? await c.backupMemes(slug, 1) : [];
          if (!backup.length) throw e;
          return summary(backup[0]!);
        }
        return { ...summary(toMemeSummary(row)), note: "这个梗只能查到释义和使用场景，没有完整解释和例句" };
      }
      return {
        ...summary(m),
        body: m.body,
        usage_examples: m.usage_examples,
        related: m.related.map((r) => ({ slug: r.slug, title: r.title })),
      };
    },

    async trending_memes({ tag = "", limit = 10 }) {
      return (await c.trending(tag, limit)).map(summary);
    },

    async search_stickers({ q, limit = 5 }) {
      if (c.stickerFrequency === 0) return [];
      return (await c.searchStickers(q, limit)).map((s) => ({ caption: s.caption, url: s.url, pack: s.pack_title }));
    },

    async search_people({ q, limit = 5 }) {
      return (await c.people(q)).slice(0, Math.max(0, limit)).map((p) => person(p, PROMPT_BIO, 3));
    },

    async get_person({ name }) {
      const p = await c.person(name);
      return { ...person(p), memes: p.memes.map((m) => ({ slug: m.slug, title: m.title })) };
    },

    async search_lexicon({ q, limit = 10 }) {
      return (await c.searchLexicons(q, limit)).map((e) => ({ term: e.term, aliases: e.aliases, note: e.note }));
    },
  };
}

const get = (obj: any, name: string): any => (obj === null || obj === undefined ? undefined : obj[name]);

export class Tools {
  private readonly handlers: Record<string, Handler>;

  constructor(private readonly c: GengWiki) {
    this.handlers = handlers(c);
  }

  /** Definitions for OpenAI, DeepSeek and anything else that takes chat completions tools. */
  openai(names?: Iterable<string>): { type: "function"; function: ToolDefinition }[] {
    return this.pick(names).map((d) => ({ type: "function", function: d }));
  }

  /** Definitions for the OpenAI Responses API. */
  responses(names?: Iterable<string>): ({ type: "function" } & ToolDefinition)[] {
    return this.pick(names).map((d) => ({ type: "function", ...d }));
  }

  /** Definitions for the Claude API. */
  anthropic(names?: Iterable<string>): { name: string; description: string; input_schema: ToolDefinition["parameters"] }[] {
    return this.pick(names).map((d) => ({ name: d.name, description: d.description, input_schema: d.parameters }));
  }

  private pick(names?: Iterable<string>): ToolDefinition[] {
    const wanted = names === undefined ? null : new Set(names);
    return DEFINITIONS.filter((d) => wanted === null || wanted.has(d.name)).map((d) => structuredClone(d));
  }

  /** Run one tool and return JSON for the model. Failures come back as JSON too, so the model can react instead of the loop crashing. */
  async call(name: string, args?: string | Record<string, unknown> | null): Promise<string> {
    let result: unknown;
    try {
      result = await this.handlers[name]!(checkArgs(name, args));
    } catch (e) {
      if (e instanceof GengWikiError) {
        result = { error: { code: e.code, message: e.message } };
      } else if (e instanceof TypeError || e instanceof SyntaxError) {
        // The model passed bad arguments, tell it so it can try again.
        result = { error: { code: "bad_arguments", message: e.message } };
      } else {
        throw e;
      }
    }
    return JSON.stringify(result);
  }

  /** Run every tool call in a model reply and return the messages to append. Takes SDK objects or plain objects, from any of the three APIs. */
  async run(message: any): Promise<Row[]> {
    const choices = get(message, "choices");
    // handed the whole chat completion
    if (Array.isArray(choices) && choices.length) message = get(choices[0], "message");
    const output = get(message, "output");
    if (Array.isArray(output)) {
      const replies: Row[] = [];
      for (const item of output) {
        if (get(item, "type") !== "function_call") continue;
        const content = await this.call(get(item, "name"), get(item, "arguments"));
        replies.push({ type: "function_call_output", call_id: get(item, "call_id"), output: content });
      }
      return replies;
    }
    const calls = get(message, "tool_calls");
    if (Array.isArray(calls) && calls.length) {
      const replies: Row[] = [];
      for (const call of calls) {
        const fn = get(call, "function");
        replies.push({ role: "tool", tool_call_id: get(call, "id"), content: await this.call(get(fn, "name"), get(fn, "arguments")) });
      }
      return replies;
    }
    const content = get(message, "content");
    const blocks = Array.isArray(content) ? content.filter((b) => get(b, "type") === "tool_use") : [];
    if (!blocks.length) return [];
    const results: Row[] = [];
    for (const b of blocks) {
      results.push({ type: "tool_result", tool_use_id: get(b, "id"), content: await this.call(get(b, "name"), get(b, "input")) });
    }
    return [{ role: "user", content: results }];
  }
}
