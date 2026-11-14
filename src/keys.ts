/** API keys. Saved keys work with no login, creating and rotating go through the account API. */

import type { GengWiki } from "./client";
import { AccountApiUnavailable, AuthError, ForbiddenError, GengWikiError, NotFoundError, UnavailableError } from "./errors";
import type { Shape } from "./http";
import type { KeyringData } from "./keyring";
import { type ApiKey, type LocalKey, toApiKey } from "./models";
import type { Row } from "./search";
import { namespace } from "./store";

/** What the server stores in the clear: gwk_live_ and 6 more characters. */
const PREFIX_LEN = "gwk_live_".length + 6;

const enc = encodeURIComponent;
const unique = (items: string[]) => [...new Set(items)];

export interface CreateKeyOptions {
  /** A persona by title or id. It also brings in its memes, sticker packs and people. */
  persona?: string;
  memes?: string[];
  packs?: string[];
  people?: string[];
  /** Defaults to every scope. */
  scopes?: string[];
}

export class Keys {
  constructor(private readonly c: GengWiki) {}

  private get ring() {
    return this.c.keyring;
  }

  // ---------- saved on this machine, no request ----------

  /** Save a key made on the website. The first key saved becomes the current one. */
  add(name: string, key: string): LocalKey {
    if (!key.startsWith("gwk_")) throw new TypeError("an API key starts with gwk_");
    const first = this.ring.edit((data) => {
      const saved = data.keys[name];
      if (saved && saved.key !== key) throw new TypeError(`a different key is already saved as ${JSON.stringify(name)}`);
      data.keys[name] ??= { key };
      if (data.current !== undefined) return false;
      data.current = name;
      return true;
    });
    if (first && !this.c.key) this.c.key = key;
    return this.one(name);
  }

  /** Every key saved on this machine for this API host. */
  local(): LocalKey[] {
    const data = this.ring.read();
    return Object.keys(data.keys).map((name) => this.describe(data, name));
  }

  private one(name: string): LocalKey {
    return this.describe(this.ring.read(), name);
  }

  private describe(data: KeyringData, name: string): LocalKey {
    const e = data.keys[name]!;
    return {
      name,
      prefix: e.key.slice(0, PREFIX_LEN),
      id: e.id ?? null,
      persona_id: e.persona_id ?? null,
      persona_title: e.persona_title ?? null,
      current: e.key === this.c.key,
    };
  }

  /** The key itself, for handing to another program. */
  secret(name: string): string {
    const e = this.ring.read().keys[name];
    if (!e) throw new NotFoundError(`no key saved as ${JSON.stringify(name)}`, 404, "not_found");
    return e.key;
  }

  /** Switch this client to a saved key, and make it the default for new clients. */
  use(name: string): LocalKey {
    this.ring.edit((data) => {
      const e = data.keys[name];
      if (!e) throw new NotFoundError(`no key saved as ${JSON.stringify(name)}`, 404, "not_found");
      data.current = name;
      this.c.key = e.key;
    });
    return this.one(name);
  }

  /** Forget a key on this machine. It keeps working on the server, revoke() ends it there. */
  remove(name: string): void {
    const e = this.ring.edit((data) => {
      const e = data.keys[name];
      delete data.keys[name];
      if (data.current === name) delete data.current;
      return e;
    });
    if (!e) return;
    this.c.store.drop(namespace(e.key));
    if (this.c.key === e.key) this.c.key = null;
  }

  // ---------- personas ----------

  /** @internal What the server says about the persona of a saved key, remembered in the keyring. */
  async personaRow(name: string): Promise<Row | null> {
    const key = this.ring.read().keys[name]!.key;
    let row: Row | null;
    try {
      row = await this.c.personaRow(key);
    } catch (e) {
      // no persona, no scope, or the persona is not published right now
      if (!(e instanceof NotFoundError || e instanceof ForbiddenError)) throw e;
      row = null;
    }
    this.ring.edit((data) => {
      const saved = data.keys[name];
      if (!saved) return;
      saved.persona_id = row?.id ?? null;
      saved.persona_title = row?.title ?? null;
    });
    return row;
  }

  /** @internal The saved key bound to this persona. What the keyring remembers first, a persona can be renamed so a miss asks the server. */
  async nameForPersona(wanted: string): Promise<string | null> {
    const keys = this.ring.read().keys;
    const matches = (id: string | null | undefined, title: string | null | undefined) =>
      wanted === id || (title != null && wanted.toLowerCase() === title.toLowerCase());
    for (const [name, e] of Object.entries(keys)) if (matches(e.persona_id, e.persona_title)) return name;
    for (const name of Object.keys(keys)) {
      let row: Row | null;
      try {
        row = await this.personaRow(name);
      } catch (e) {
        // revoked or the server is down, this key cannot answer now
        if (e instanceof GengWikiError) continue;
        throw e;
      }
      if (row && matches(row.id, row.title)) return name;
    }
    return null;
  }

  // ---------- account API ----------

  /** Log in to manage keys. The password is not kept, only a token that lasts seven days. */
  async login(email: string, password: string): Promise<Row> {
    const r = await this.account<Row>("POST", "/auth/login", { email, password }, null, Object);
    this.ring.edit((data) => {
      data.session = { token: r.token, expires_at: Date.now() / 1000 + r.expires_in };
    });
    return r.user;
  }

  logout(): void {
    this.ring.edit((data) => {
      delete data.session;
    });
  }

  get loggedIn(): boolean {
    const s = this.ring.read().session;
    return !!s && s.expires_at > Date.now() / 1000;
  }

  private async account<T>(method: string, path: string, body: unknown, token: string | null, expect?: Shape): Promise<T> {
    try {
      return await this.c.http.json<T>(method, `${this.c.siteUrl}/api${path}`, { token, body, expect });
    } catch (e) {
      // An error without a code did not come from the account API, so the site does not serve it.
      if (e instanceof GengWikiError && !(e instanceof UnavailableError) && e.code === null) {
        throw new AccountApiUnavailable(
          `${this.c.siteUrl} does not expose the account API. Create keys on the website and save them with keys.add()`,
        );
      }
      throw e;
    }
  }

  private async session<T = Row>(method: string, path: string, body?: unknown, expect: Shape | null = Object): Promise<T> {
    if (!this.loggedIn) throw new AuthError("not logged in. Call client.keys.login(email, password) first", null, "unauthorized");
    try {
      return await this.account<T>(method, path, body, this.ring.read().session!.token, expect ?? undefined);
    } catch (e) {
      if (e instanceof AuthError) this.logout();
      throw e;
    }
  }

  /** All keys on the account, as the server sees them. Always live, this is rare and must be accurate. */
  async list({ includeRevoked = false }: { includeRevoked?: boolean } = {}): Promise<ApiKey[]> {
    const rows = (await this.session<Row[]>("GET", "/me/keys", undefined, Array)).map(toApiKey);
    return includeRevoked ? rows : rows.filter((r) => !r.revoked_at);
  }

  /** Create a key and save it here, since the server shows the secret only this once. */
  async create(name: string, { persona, memes = [], packs = [], people = [], scopes }: CreateKeyOptions = {}): Promise<LocalKey> {
    let personaId: string | null = null;
    if (persona) {
      const row = await this.c.catalogRow(persona);
      personaId = row.id;
      memes = unique([...memes, ...row.memes.map((m: Row) => m.slug)]);
      packs = unique([...packs, ...row.packs.map((p: Row) => p.id)]);
      people = unique([...people, ...(row.people ?? []).map((p: Row) => p.id)]);
    }
    const body: Row = { name, memes, packs, people, persona: personaId };
    if (scopes !== undefined) body.scopes = scopes;
    return this.save(await this.session("POST", "/me/keys", body));
  }

  private save(created: Row, name?: string | null): LocalKey {
    const row = created.api_key;
    const saved = this.ring.edit((data) => {
      let n = name;
      if (!n) {
        n = row.name as string;
        // Names repeat on the server but not here, and this secret must not be lost.
        if (n in data.keys) n = `${n}-${row.prefix.slice(-6)}`;
      }
      data.keys[n] = { key: created.key, id: row.id, persona_id: row.persona?.id ?? null, persona_title: row.persona?.title ?? null };
      data.current ??= n;
      return n;
    });
    if (!this.c.key) this.c.key = created.key;
    return this.one(saved);
  }

  /** A saved name, a remote name or an id, as [id, saved name, the secret if this machine holds it]. */
  private async resolve(ref: string): Promise<[string, string | null, string | null]> {
    const keys = this.ring.read().keys;
    const saved = keys[ref];
    if (saved?.id) return [saved.id, ref, saved.key];
    const rows = await this.list();
    const found = saved ? rows.filter((r) => r.prefix === saved.key.slice(0, PREFIX_LEN)) : rows.filter((r) => r.id === ref || r.name === ref);
    if (!found.length) throw new NotFoundError(`no active key ${JSON.stringify(ref)} on this account`, 404, "not_found");
    if (found.length > 1) throw new TypeError(`${found.length} keys are named ${JSON.stringify(ref)}, use the id`);
    const { id, prefix } = found[0]!;
    const local = Object.entries(keys).find(([, e]) => e.key.slice(0, PREFIX_LEN) === prefix)?.[0];
    if (local) return [id, local, keys[local]!.key];
    const mine = this.c.key?.slice(0, PREFIX_LEN) === prefix ? this.c.key : null;
    return [id, null, mine];
  }

  /** New secret, same name and scope. The local cache moves over, so rotating costs no download. */
  async rotate(ref: string): Promise<LocalKey> {
    const [id, local, old] = await this.resolve(ref);
    const created = await this.session("POST", `/me/keys/${enc(id)}/rotate`);
    if (old && this.c.key === old) this.c.key = created.key;
    const saved = this.save(created, local);
    if (old) this.c.store.rename(namespace(old), namespace(created.key));
    return saved;
  }

  /** End a key on the server and forget it here. */
  async revoke(ref: string): Promise<void> {
    const [id, local, secret] = await this.resolve(ref);
    await this.session("DELETE", `/me/keys/${enc(id)}`, undefined, null);
    if (local) this.remove(local);
    if (secret) {
      this.c.store.drop(namespace(secret));
      if (this.c.key === secret) this.c.key = null;
    }
  }
}
