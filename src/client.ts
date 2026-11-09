/** The client. Every read goes local first, the network is the fallback. */

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AuthError, ForbiddenError, NotFoundError, RateLimitError, UnavailableError } from "./errors";
import { Http, type Params, type Shape, checkUrl } from "./http";
import { Keyring } from "./keyring";
import { type Meme, type MemeSummary, toMeme, toMemeSummary } from "./models";
import * as search from "./search";
import type { Row } from "./search";
import { type Hit, Store, namespace } from "./store";

export const DEFAULT_API_URL = "https://api.gengwiki.com";
export const DEFAULT_SITE_URL = "https://gengwiki.com";

/** The API returns at most this many rows and has no paging. Fewer rows than this means the list is complete. */
export const LIST_MAX = 100;
/** How much of a subscribed tag's board reaches the model. */
export const TAG_TOP = 5;

// Seconds. A key's scope is fixed when it is created, but what it points at can be edited or taken down at any time.
// refresh() is there for whoever cannot wait this long.
export const TTL_LIST = 6 * 3600;
export const TTL_TRENDING = 15 * 60;
/** A tag may get its first meme at any time, so an empty board checks again, at most this often. */
export const TTL_EMPTY_BOARD = 60;
export const TTL_MISSING = 3600;
/** After a failed refresh the old copy is served for this long with no request, or for the whole of a Retry-After. */
export const OUTAGE_PAUSE = 60;

/** Data that is the same for every key. */
const SHARED = "shared";
const MISSING = { __missing__: true };
const isMissing = (value: unknown) => typeof value === "object" && value !== null && (value as Row).__missing__ === true;

// What the SDK reads from each answer without a default, checked before an answer reaches the cache. All of it is non-null on the server.
const MEME_ROW: Shape = { slug: String, title: String, aliases: Array, summary: String, heat: Number, updated_at: String };
const MEME: Shape = { slug: String, title: String, updated_at: String };

export const QUOTE_MODES = ["off", "cite", "use", "both"] as const;
export type QuoteMode = (typeof QUOTE_MODES)[number];

export interface Logger {
  warn(message: string): void;
  info?(message: string): void;
}

export interface GengWikiOptions {
  /** Defaults to GENGWIKI_API_KEY, then the current saved key. */
  apiKey?: string;
  /** The API address, with or without /v1. Defaults to GENGWIKI_API_URL, then the public API. */
  baseUrl?: string;
  /** The website, for the account API and the persona catalog. Defaults to GENGWIKI_SITE_URL, then the public site. */
  siteUrl?: string;
  /** Where keys and the cache live. Defaults to GENGWIKI_HOME, then ~/.gengwiki. */
  home?: string;
  /** Seconds before a request gives up. */
  timeout?: number;
  logger?: Logger;
}

const now = () => Date.now() / 1000;

const defaultLogger: Logger = { warn: (message) => console.warn(`gengwiki: ${message}`) };

const enc = encodeURIComponent;

interface CachedOptions {
  token: string | null;
  params?: Params;
  valid?: (value: any) => boolean;
  expect: Shape;
}

export class GengWiki {
  readonly baseUrl: string;
  readonly siteUrl: string;
  /** The folder for this API host. */
  readonly home: string;

  /** @internal */ readonly http: Http;
  /** @internal */ readonly store: Store;
  /** @internal */ readonly keyring: Keyring;
  /** @internal */ readonly log: Logger;
  /** @internal */ key: string | null;
  /** By token, since a rate limit belongs to one key. */
  private paused = new Map<string, number>();
  /** The same miss shares one fetch, an unrelated one does not wait for it. */
  private inflight = new Map<string, Promise<any>>();

  constructor(options: GengWikiOptions | string = {}) {
    const o: GengWikiOptions = typeof options === "string" ? { apiKey: options } : options;
    this.log = o.logger ?? defaultLogger;
    // The docs give the API address with /v1, so take it with or without.
    this.baseUrl = checkUrl(o.baseUrl || process.env.GENGWIKI_API_URL || DEFAULT_API_URL).replace(/\/v1$/, "");
    this.siteUrl = checkUrl(o.siteUrl || process.env.GENGWIKI_SITE_URL || DEFAULT_SITE_URL);
    // One folder per API host, so a key saved for one host is never sent to another.
    const host = new URL(this.baseUrl).host.replaceAll(":", "_");
    this.home = join(o.home || process.env.GENGWIKI_HOME || join(homedir(), ".gengwiki"), host);
    try {
      mkdirSync(this.home, { recursive: true, mode: 0o700 });
    } catch (e) {
      this.log.warn(`cannot create ${this.home}, caching in memory only: ${e}`);
    }
    this.http = new Http(o.timeout ?? 15);
    this.store = new Store(join(this.home, "cache.sqlite3"), (m) => this.log.warn(m));
    this.keyring = new Keyring(join(this.home, "keys.json"), (m) => this.log.warn(m));
    this.key = o.apiKey || process.env.GENGWIKI_API_KEY || null;
    if (!this.key) {
      const saved = this.keyring.read();
      this.key = (saved.current && saved.keys[saved.current]?.key) || null;
    }
  }

  close(): void {
    this.store.close();
  }

  /** Requests this client has actually sent. Handy for seeing what the cache saves. */
  get requestCount(): number {
    return this.http.count;
  }

  /** @internal */
  get ns(): string {
    return namespace(this.key);
  }

  /** True while a failed refresh has this client serving old copies. */
  get stale(): boolean {
    const t = now();
    return [...this.paused.values()].some((until) => t < until);
  }

  /**
   * Make the next read of everything go to the network, for every saved key too. The old data stays as a fallback.
   * A meme's text is only read again if the list says it changed, and sticker images never change.
   */
  refresh(): void {
    this.store.expire(this.ns);
    this.store.expire(SHARED);
    for (const saved of Object.values(this.keyring.read().keys)) this.store.expire(namespace(saved.key));
    this.paused.clear();
  }

  /** @internal Shares one promise between callers of the same work until it settles. */
  once<T>(id: string, work: () => Promise<T>): Promise<T> {
    let p = this.inflight.get(id);
    if (!p) {
      p = work().finally(() => this.inflight.delete(id));
      this.inflight.set(id, p);
    }
    return p;
  }

  /** @internal Return the local copy if it is good, otherwise fetch it. An outage serves the old copy instead of failing. */
  async cached(ns: string, key: string, url: string, ttl: number, { token, params, valid, expect }: CachedOptions): Promise<any> {
    const good = (hit: Hit | null): boolean => {
      if (hit === null) return false;
      if (isMissing(hit.value)) return hit.age < TTL_MISSING;
      return valid ? valid(hit.value) : hit.age < ttl;
    };
    const answer = (hit: Hit) => {
      if (isMissing(hit.value)) throw new NotFoundError("resource not found", 404, "not_found");
      return hit.value;
    };

    const hit = this.store.get(ns, key);
    if (good(hit)) return answer(hit!);
    return this.once(`${ns}\0${key}`, async () => {
      // Another process may have filled it meanwhile.
      const hit = this.store.get(ns, key);
      if (good(hit)) return answer(hit!);
      const usable = hit !== null && !isMissing(hit.value);
      const old = hit?.value;
      if (usable && now() < (this.paused.get(token ?? "") ?? 0)) return old;
      let value: unknown;
      try {
        // With an old copy in hand a retry only delays the answer.
        value = await this.http.json("GET", url, { token, params, retries: usable ? 0 : 1, expect });
      } catch (e) {
        if (e instanceof NotFoundError) this.store.put(ns, key, MISSING);
        if (e instanceof UnavailableError && usable) {
          this.log.warn(`serving a stale copy of ${url}: ${e.message}`);
          const wait = e instanceof RateLimitError ? e.retryAfter : 0;
          this.paused.set(token ?? "", now() + Math.max(wait, OUTAGE_PAUSE));
          return old;
        }
        throw e;
      }
      this.store.put(ns, key, value);
      return value;
    });
  }

  /** @internal */
  token(): string {
    if (!this.key) {
      throw new AuthError(
        `no API key. Create one at ${this.siteUrl}/me, then pass apiKey, set GENGWIKI_API_KEY, or save it with the gengwiki command`,
        null,
        "unauthorized",
      );
    }
    return this.key;
  }

  /** @internal */
  v1(key: string, path: string, ttl: number, options: Omit<CachedOptions, "token"> & { shared?: boolean }): Promise<any> {
    // Without a key the server answers as a guest, the top 20 hot memes and 10 people, so that copy is never shared.
    const ns = options.shared && this.key ? SHARED : this.ns;
    const token = path.startsWith("/me/") ? this.token() : this.key;
    return this.cached(ns, key, `${this.baseUrl}/v1${path}`, ttl, { ...options, token });
  }

  // ---------- memes ----------

  /** @internal Everything this key can see, up to LIST_MAX. Searches and detail lookups all lean on this one request. */
  list(): Promise<Row[]> {
    return this.v1("list", "/memes/search", TTL_LIST, { params: { q: "", limit: LIST_MAX }, expect: [MEME_ROW] });
  }

  private serverSearch(q: string): Promise<Row[]> {
    return this.v1(`search:${q.toLowerCase()}`, "/memes/search", TTL_LIST, { params: { q, limit: LIST_MAX }, expect: [MEME_ROW] });
  }

  /** Search this key's memes. An empty q lists them by heat. */
  async searchMemes(q = "", limit = 20): Promise<MemeSummary[]> {
    limit = Math.max(1, Math.min(limit, LIST_MAX));
    const rows = await this.list();
    if (rows.length < LIST_MAX || !q.trim()) return search.searchMemes(q, rows, limit).map(toMemeSummary);
    // The list is cut off, so only the server can search the rest.
    return (await this.serverSearch(q.trim())).slice(0, limit).map(toMemeSummary);
  }

  /** One meme with its full text. Takes a slug, or an exact title or alias. */
  async meme(slug: string): Promise<Meme> {
    const rows = await this.list();
    const wanted = slug.trim().toLowerCase();
    const row =
      rows.find((r) => r.slug === slug) ?? rows.find((r) => [r.title, ...r.aliases].some((s: string) => s.toLowerCase() === wanted));
    if (!row) {
      if (rows.length < LIST_MAX) {
        const near = search.searchMemes(slug, rows, 3).map((r) => r.slug);
        const hint = near.length ? `, did you mean ${near.join(", ")}` : "";
        throw new NotFoundError(`${JSON.stringify(slug)} is not among this key's memes${hint}`, 404, "not_found");
      }
      // Past the end of the list. Only the server knows whether this key may read it, so cache it per key.
      return toMeme(await this.v1(`meme:${slug}`, `/memes/${enc(slug)}`, TTL_LIST, { expect: MEME }));
    }
    // The list proved this key may read it, so the text can be shared between keys.
    // The list's updated_at says whether the copy is current, which saves one request per meme.
    const current = (m: Row) => m.updated_at === row.updated_at;
    return toMeme(await this.v1(`meme:${row.slug}`, `/memes/${enc(row.slug)}`, 0, { shared: true, valid: current, expect: MEME }));
  }

  /** The hot board, 20 rows site-wide or a tag's top 5 unless limit says otherwise. Not limited by the key's scope, so all keys share one copy. */
  async trending(tag = "", limit?: number): Promise<MemeSummary[]> {
    limit ??= tag ? TAG_TOP : 20;
    return (await this.board(tag)).slice(0, Math.max(1, Math.min(limit, LIST_MAX))).map(toMemeSummary);
  }

  /** @internal Always the full board, so a different limit later is not another request. */
  async board(tag = ""): Promise<Row[]> {
    const read = (ttl: number): Promise<Row[]> =>
      this.v1(`trending:${tag}`, "/trending", ttl, { shared: true, params: { tag, limit: LIST_MAX }, expect: [MEME_ROW] });
    const rows = await read(TTL_TRENDING);
    return rows.length ? rows : read(TTL_EMPTY_BOARD);
  }

  /** @internal A board that only adds to what a reply can use, so an outage on one never read must not cost the memes that are cached. */
  async extraBoard(tag = ""): Promise<Row[]> {
    try {
      return await this.board(tag);
    } catch (e) {
      if (!(e instanceof UnavailableError)) throw e;
      this.log.warn(`skipping the board ${JSON.stringify(tag)}: ${e.message}`);
      return [];
    }
  }

  /** @internal Every meme a bot may bring up, each once. This key's own first, then the hot board. A key without one of the scopes just has fewer. */
  async pool(): Promise<Row[]> {
    const rows = new Map<string, Row>();
    for (const read of [() => this.list(), () => this.extraBoard()]) {
      try {
        for (const r of await read()) if (!rows.has(r.slug)) rows.set(r.slug, r);
      } catch (e) {
        if (!(e instanceof ForbiddenError)) throw e;
      }
    }
    return [...rows.values()];
  }

  /** Search every meme a bot may bring up, this key's and the hot board, best match first. Only this key's have the text meme() returns. */
  async findMemes(q = "", limit = 20): Promise<MemeSummary[]> {
    limit = Math.max(1, Math.min(limit, LIST_MAX));
    const rows = new Map((await this.pool()).map((r) => [r.slug as string, r]));
    // says so if this key may read none of it
    if (!rows.size) return this.searchMemes(q, limit);
    q = q.trim();
    try {
      if (q && (await this.list()).length >= LIST_MAX) {
        // The list is cut off, so only the server can search the rest of this key's.
        for (const r of await this.serverSearch(q)) rows.set(r.slug, r);
      }
    } catch (e) {
      if (!(e instanceof ForbiddenError)) throw e;
    }
    return search.searchMemes(q, [...rows.values()], limit).map(toMemeSummary);
  }
}
