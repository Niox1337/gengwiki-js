/**
 * A stand-in for both gengwiki services on one port, following the API and the website backend.
 * It counts every request, because request counts are what these tests are about.
 */

import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export const KEY_A = "gwk_live_aaaaaa" + "0".repeat(42);
export const KEY_B = "gwk_live_bbbbbb" + "0".repeat(42);
export const PERSONA_A = "11111111-1111-1111-1111-111111111111";
export const PERSONA_B = "22222222-2222-2222-2222-222222222222";
export const PACK = "33333333-3333-3333-3333-333333333333";
export const STICKER = "44444444-4444-4444-4444-444444444444";
export const LU_XUN = "55555555-5555-5555-5555-555555555555";
export const DU_FU = "66666666-6666-6666-6666-666666666666";
export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
export const ALL_SCOPES = [
  "memes:read",
  "trending:read",
  "persona:read",
  "stickers:read",
  "people:read",
  "lexicon:read:self",
  "lexicon:write:self",
  "self:write",
];
export const TOKEN = "jwt-token";
export const SUMMARY = ["slug", "title", "aliases", "summary", "usage_scenario", "categories", "heat", "updated_at"] as const;

type Row = Record<string, any>;

export function meme(slug: string, title: string, heat = 1, aliases: string[] = [], updated_at = "2026-01-01T00:00:00Z"): Row {
  return {
    id: `id-${slug}`,
    slug,
    title,
    aliases,
    summary: `${title}的释义`,
    usage_scenario: `${title}的场景`,
    body: `${title}的正文`,
    usage_examples: [`${title}的例句`],
    categories: ["网络"],
    heat,
    first_seen: null,
    updated_at,
    related: [],
    contributors: [{ name: "鲸鱼", edits: 1, avatar_id: null }],
  };
}

const summary = (m: Row) => Object.fromEntries(SUMMARY.map((f) => [f, m[f]]));

export interface FakeKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  memes: string[];
  persona: string | null;
  packs: string[];
  people: string[];
  revoked: boolean;
  guest?: boolean;
}

export class Fake {
  memes: Record<string, Row> = Object.fromEntries(
    [meme("tang-ping", "躺平", 9, ["摆烂"]), meme("yyds", "YYDS", 5, ["永远的神"])].map((m) => [m.slug, m]),
  );
  personas: Record<string, Row> = {
    [PERSONA_A]: Fake.persona(PERSONA_A, "毒舌老哥", ["tang-ping"], [PACK]),
    [PERSONA_B]: Fake.persona(PERSONA_B, "温柔姐姐", ["yyds"], []),
  };
  packs: Record<string, Row> = {
    [PACK]: { id: PACK, title: "猫猫", description: "", tags: ["可爱"], stickers: [{ id: STICKER, caption: "震惊" }] },
  };
  people: Record<string, Row> = {
    [LU_XUN]: { id: LU_XUN, name: "鲁迅", aliases: ["周树人"], tags: ["作家"], bio: "现代文学家", quotes: ["我家门前有两棵树"] },
    [DU_FU]: { id: DU_FU, name: "杜甫", aliases: [], tags: ["诗人"], bio: "唐代诗人", quotes: [] },
  };
  keys: Record<string, FakeKey> = {
    [KEY_A]: this.key(KEY_A, "a", PERSONA_A, ["tang-ping", "yyds"], [PACK], undefined, [LU_XUN]),
    [KEY_B]: this.key(KEY_B, "b", PERSONA_B, ["yyds"], []),
  };
  /** What the backup wiki has. */
  backup: Row[] = [];
  lexicons: Record<string, Row> = {};
  entries: Record<string, Row[]> = {};
  /** By name, like the API's upserts. */
  mine: Record<string, Record<string, Row>> = { words: {}, stickers: {}, personas: {}, people: {} };
  hits: [string, string][] = [];
  /** Answer everything with this status. */
  status: number | null = null;
  /** Answer everything with a 200 HTML page, like a captive portal. */
  htmlOk = false;
  /** Answer everything with a 200 and this JSON, like a proxy that rewrites replies. */
  jsonOk: unknown = undefined;
  /** False is what the public site does today. */
  accountOpen = true;

  static persona(id: string, title: string, memes: string[], packs: string[]): Row {
    return {
      id,
      title,
      description: "",
      prompt: `你是${title}`,
      tags: [],
      author: "鲸鱼",
      status: "published",
      memes: memes.map((s) => ({ slug: s, title: s, summary: "" })),
      packs: packs.map((p) => ({ id: p, title: "猫猫", cover: STICKER })),
      people: packs.length ? [{ id: LU_XUN, name: "鲁迅", aliases: ["周树人"], quotes: 1 }] : [],
    };
  }

  key(token: string, name: string, persona: string | null, memes: string[], packs: string[], scopes?: string[], people: string[] = []): FakeKey {
    return {
      id: randomUUID(),
      name,
      prefix: token.slice(0, 15),
      scopes: scopes ?? [...ALL_SCOPES],
      memes,
      persona,
      packs,
      people: [...people],
      revoked: false,
    };
  }

  publicKey(k: FakeKey): Row {
    return {
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      scopes: k.scopes,
      memes: k.memes.map((s) => ({ slug: s, title: s })),
      persona: k.persona ? { id: k.persona, title: this.personas[k.persona]!.title } : null,
      packs: k.packs.map((p) => ({ id: p, title: "猫猫" })),
      people: k.people.map((p) => ({ id: p, name: this.people[p]!.name })),
      created_at: "2026-01-01T00:00:00Z",
      last_used_at: null,
      revoked_at: k.revoked ? "2026-01-02T00:00:00Z" : null,
    };
  }

  /** A call without a key, like the API's guest caller. The top 20 hot memes and the first 10 people. */
  guest(): FakeKey {
    const top = Object.values(this.memes)
      .sort((a, b) => b.heat - a.heat)
      .slice(0, 20);
    return {
      id: "guest",
      name: "guest",
      prefix: "",
      scopes: ["memes:read", "trending:read", "people:read", "persona:read", "stickers:read"],
      memes: top.map((m) => m.slug),
      persona: null,
      packs: [],
      people: Object.keys(this.people).slice(0, 10),
      revoked: false,
      guest: true,
    };
  }

  count(prefix = ""): number {
    return this.hits.filter(([, p]) => p.startsWith(prefix)).length;
  }
}

/** Thrown once a scope check has answered, to stop routing. */
class Replied extends Error {}

const newToken = () => `gwk_live_${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "").slice(0, 16)}`;

export async function serve(fake: Fake): Promise<{ url: string; stop: () => Promise<void> }> {
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    try {
      route(fake, req, res, Buffer.concat(chunks));
    } catch (e) {
      if (!(e instanceof Replied)) {
        res.writeHead(500);
        res.end(String(e));
      }
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function route(fake: Fake, req: IncomingMessage, res: ServerResponse, raw: Buffer): void {
  const reply = (status: number, body?: unknown, headers: Record<string, string> = {}) => {
    const data = body === undefined ? Buffer.alloc(0) : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    res.writeHead(status, { "Content-Length": String(data.length), ...(Buffer.isBuffer(body) ? {} : { "Content-Type": "application/json" }), ...headers });
    res.end(data);
  };
  const error = (status: number, code: string) => reply(status, { error: { code, message: code } });
  const token = () => (req.headers.authorization ?? "").replace(/^Bearer /, "");
  const json = (): Row => (raw.length ? JSON.parse(raw.toString("utf8")) : {});

  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", "http://fake");
  const q = Object.fromEntries(url.searchParams);
  const path = decodeURIComponent(url.pathname);
  fake.hits.push([method, path]);

  if (fake.htmlOk) return reply(200, Buffer.from("<html>登录 Wi-Fi</html>"), { "Content-Type": "text/html" });
  if (fake.jsonOk !== undefined) return reply(200, fake.jsonOk);
  if (fake.status === 429) return reply(429, { error: { code: "rate_limited", message: "x" } }, { "Retry-After": "3600" });
  if (fake.status) return error(fake.status, "internal");
  if (path === "/backup") {
    const word = (q.q ?? "").toLowerCase();
    const items = fake.backup.filter((i) => [i.title, ...i.aliases].some((s: string) => s.toLowerCase().includes(word)));
    return reply(200, { schema_version: 1, items, has_more: false });
  }
  if (path.startsWith("/v1/")) return v1(path.slice(3));
  if (path.startsWith("/api/")) {
    if (!fake.accountOpen) return reply(404, Buffer.from("<html>not found</html>"), { "Content-Type": "text/html" });
    return account(path.slice(4));
  }
  return reply(404, Buffer.from("<html>"));

  function v1(path: string): void {
    if (path.startsWith("/stickers/") && path.endsWith("/image")) {
      if (path.split("/")[2] === STICKER) return reply(200, PNG, { "Content-Type": "image/png" });
      return error(404, "not_found");
    }
    const k = token() ? fake.keys[token()] : path.startsWith("/me/") ? undefined : fake.guest();
    if (!k || k.revoked) return error(401, "unauthorized");
    const guest = k.guest ?? false;
    const need = (scope: string) => {
      if (k.scopes.includes(scope)) return true;
      error(403, "forbidden");
      throw new Replied();
    };

    let limit = Math.max(1, Math.min(Number(q.limit ?? 20), 100));
    const scoped = k.memes
      .filter((s) => s in fake.memes)
      .map((s) => fake.memes[s]!)
      .sort((a, b) => b.heat - a.heat);
    if (path === "/memes/search" && need("memes:read")) {
      const term = (q.q ?? "").trim().toLowerCase();
      const rows = scoped.filter((m) => [m.title, ...m.aliases, m.usage_scenario].join(" ").toLowerCase().includes(term));
      return reply(200, rows.slice(0, limit).map(summary));
    }
    if (path.startsWith("/memes/") && need("memes:read")) {
      const m = scoped.find((m) => m.slug === path.slice(7));
      return m ? reply(200, m) : error(404, "not_found");
    }
    if (path === "/tags" && need("trending:read")) {
      const counts = new Map<string, number>();
      for (const m of guest ? [] : Object.values(fake.memes)) for (const c of m.categories) counts.set(c, (counts.get(c) ?? 0) + 1);
      const rows = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      return reply(
        200,
        rows.map(([name, count]) => ({ name, count })),
      );
    }
    if (path === "/trending" && need("trending:read")) {
      const tag = q.tag ?? "";
      let rows = Object.values(fake.memes)
        .filter((m) => !tag || m.categories.includes(tag))
        .sort((a, b) => b.heat - a.heat);
      if (tag && !("limit" in q)) limit = 5;
      if (guest) {
        rows = tag ? [] : rows;
        limit = Math.min(limit, 20);
      }
      return reply(200, rows.slice(0, limit).map(summary));
    }
    if (path === "/persona" && need("persona:read")) {
      const p = k.persona ? fake.personas[k.persona] : undefined;
      if (!p) return error(404, "not_found");
      return reply(200, { id: p.id, title: p.title, description: p.description, prompt: p.prompt, tags: p.tags });
    }
    const base = `http://${req.headers.host}`;
    if (path === "/sticker-packs" && need("stickers:read")) {
      const packs = k.packs.map((pid) => {
        const p = fake.packs[pid]!;
        return { ...p, stickers: p.stickers.map((s: Row) => ({ ...s, url: `${base}/v1/stickers/${s.id}/image` })) };
      });
      return reply(200, packs);
    }
    if (path === "/people/linked" && need("people:read")) return reply(200, k.people.map((p) => fake.people[p]));
    const people = guest ? k.people.map((p) => fake.people[p]!) : Object.values(fake.people);
    if (path === "/people" && need("people:read")) {
      const offset = Number(q.offset ?? 0);
      return reply(200, people.slice(offset, offset + limit));
    }
    if (path.startsWith("/people/") && need("people:read")) {
      const wanted = path.slice(8).toLowerCase();
      const p = people.find((p) => [p.id, p.name.toLowerCase(), ...p.aliases.map((a: string) => a.toLowerCase())].includes(wanted));
      return p ? reply(200, { ...p, memes: [{ slug: "tang-ping", title: "躺平", summary: "" }] }) : error(404, "not_found");
    }
    if (path === "/me/usage") return reply(200, { per_day: 100000, days: [{ day: "2026-01-01", requests: 3 }] });
    if (path === "/me/rate-limit") {
      return reply(200, { per_minute: 600, per_day: 100000, used_this_minute: 1, used_today: 2, reset_secs: 30 });
    }
    if (path === "/me/lexicons") {
      if (method === "POST") {
        need("lexicon:write:self");
        const lex = { id: randomUUID(), visibility: "private", entries: 0, description: "", ...json() };
        fake.lexicons[lex.id] = lex;
        fake.entries[lex.id] = [];
        return reply(201, lex);
      }
      need("lexicon:read:self");
      return reply(200, Object.values(fake.lexicons));
    }
    if (path.startsWith("/me/lexicons/") && path.endsWith("/entries")) {
      const lid = path.split("/")[3]!;
      if (!(lid in fake.lexicons)) return error(404, "not_found");
      if (method === "POST") {
        need("lexicon:write:self");
        const e = { id: randomUUID(), aliases: [], note: "", tags: [], ...json() };
        fake.entries[lid]!.push(e);
        fake.lexicons[lid]!.entries += 1;
        return reply(201, e);
      }
      need("lexicon:read:self");
      return reply(200, fake.entries[lid]);
    }
    const kind = path.startsWith("/me/") ? path.split("/")[2]! : "";
    if (kind in fake.mine && need("self:write")) {
      const store = fake.mine[kind]!;
      if (method === "DELETE") {
        const name = path.split("/").slice(3).join("/");
        if (!(name in store)) return error(404, "not_found");
        delete store[name];
        return reply(200, { deleted: 1 });
      }
      let row: Row;
      let name: string;
      if (kind === "stickers") {
        if (!raw.subarray(0, 8).equals(PNG.subarray(0, 8))) return error(400, "bad_request");
        name = q.caption ?? "";
        row = { id: randomUUID(), caption: name, url: `${base}/v1/stickers/x/image`, pack: { id: PACK, title: "我的表情包" } };
      } else {
        row = { id: randomUUID(), ...json() };
        name = row.term ?? row.title ?? row.name;
      }
      const code = name in store ? 200 : 201;
      store[name] = row;
      return reply(code, row);
    }
    return error(404, "not_found");
  }

  function account(path: string): void {
    if (method === "GET" && path === "/personas") return reply(200, Object.values(fake.personas));
    if (method === "POST" && path === "/auth/login") {
      const b = json();
      if (b.password !== "correct horse") return error(401, "unauthorized");
      return reply(200, { token: TOKEN, expires_in: 604800, user: { email: b.email } });
    }
    if (token() !== TOKEN) return error(401, "unauthorized");
    if (path === "/me/keys" && method === "GET") return reply(200, Object.values(fake.keys).map((k) => fake.publicKey(k)));
    if (path === "/me/keys" && method === "POST") {
      const b = json();
      const t = newToken();
      const k = fake.key(t, b.name, b.persona ?? null, b.memes ?? [], b.packs ?? [], b.scopes, b.people ?? []);
      fake.keys[t] = k;
      return reply(201, { key: t, api_key: fake.publicKey(k) });
    }
    // ['', 'me', 'keys', id, 'rotate']
    const parts = path.split("/");
    const old = Object.values(fake.keys).find((k) => k.id === parts[3] && !k.revoked);
    if (!old) return error(404, "not_found");
    old.revoked = true;
    if (method === "DELETE") return reply(204);
    const t = newToken();
    const k = fake.key(t, old.name, old.persona, old.memes, old.packs, old.scopes, old.people);
    fake.keys[t] = k;
    return reply(200, { key: t, api_key: fake.publicKey(k) });
  }
}
