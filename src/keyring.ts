/**
 * Saved API keys, the login token and subscribed tags, in one JSON file only this user can read.
 *
 * With @napi-rs/keyring installed the secrets go to the OS keychain, and the file keeps only a ref to each.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, renameSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { GengWikiError } from "./errors";

export interface SavedKey {
  key: string;
  id?: string | null;
  persona_id?: string | null;
  persona_title?: string | null;
  ref?: string;
}

export interface Session {
  token: string;
  /** Unix time in seconds. */
  expires_at: number;
  ref?: string;
}

export interface KeyringData {
  keys: Record<string, SavedKey>;
  current?: string;
  session?: Session;
  subscriptions?: string[];
}

export interface Keychain {
  get(service: string, ref: string): string | null;
  set(service: string, ref: string, secret: string): void;
  delete(service: string, ref: string): void;
}

interface Entry {
  getPassword(): string | null | undefined;
  setPassword(secret: string): void;
  deletePassword(): boolean;
}

/** The OS keychain through the optional @napi-rs/keyring, or null without it. Replaceable for tests. */
export const keychain = {
  load(): Keychain | null {
    let Entry: new (service: string, account: string) => Entry;
    try {
      ({ Entry } = createRequire(import.meta.url)("@napi-rs/keyring"));
    } catch {
      return null;
    }
    return {
      get: (service, ref) => new Entry(service, ref).getPassword() ?? null,
      set: (service, ref, secret) => new Entry(service, ref).setPassword(secret),
      delete: (service, ref) => void new Entry(service, ref).deletePassword(),
    };
  },
};

type Holder = { field: "key" | "token"; holder: Record<string, any> };

function* holders(data: KeyringData): Generator<Holder> {
  for (const entry of Object.values(data.keys)) yield { holder: entry, field: "key" };
  if (data.session) yield { holder: data.session, field: "token" };
}

const refs = (data: KeyringData) => new Set([...holders(data)].flatMap(({ holder }) => (holder.ref ? [holder.ref as string] : [])));

/** Seconds after which a lock left by a crashed process is taken over. */
const STALE_LOCK = 10;

const pause = new Int32Array(new SharedArrayBuffer(4));
const sleepSync = (ms: number) => Atomics.wait(pause, 0, 0, ms);

export class Keyring {
  readonly service: string;
  /** A new secret always gets a new ref, so this can never go stale. */
  private known = new Map<string, string>();

  constructor(
    readonly path: string,
    private readonly warn: (message: string) => void = () => {},
  ) {
    let real = resolve(path);
    try {
      real = join(realpathSync(dirname(path)), basename(path));
    } catch {
      // the folder may not exist yet
    }
    this.service = `gengwiki:${real}`;
  }

  read(): KeyringData {
    let data: KeyringData;
    let text: string;
    try {
      text = readFileSync(this.path, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      return { keys: {} };
    }
    try {
      data = JSON.parse(text);
    } catch (e) {
      // Secrets may be in there and are shown only once, so never overwrite this file.
      throw new GengWikiError(`${this.path} is not valid JSON, fix or delete it: ${(e as Error).message}`);
    }
    data.keys ??= {};
    for (const { holder, field } of holders(data)) {
      if (holder.ref) holder[field] = this.fetch(holder.ref);
    }
    return data;
  }

  private fetch(ref: string): string {
    let secret = this.known.get(ref);
    if (secret === undefined) {
      const chain = keychain.load();
      try {
        secret = chain?.get(this.service, ref) ?? undefined;
      } catch (e) {
        throw new GengWikiError(`cannot read a secret of ${this.path} from the OS keychain: ${(e as Error).message}`);
      }
      if (secret === undefined) {
        throw new GengWikiError(
          `${this.path} keeps a secret in the OS keychain that cannot be found. ` +
            "Install @napi-rs/keyring if it is missing, otherwise delete the file and save your keys again",
        );
      }
      this.known.set(ref, secret);
    }
    return secret;
  }

  /** What goes in the file. A secret stays in the file if the keychain refuses it, since it is shown only once. */
  private stored(data: KeyringData): KeyringData {
    const stored: KeyringData = structuredClone(data);
    const chain = keychain.load();
    for (const { holder, field } of holders(stored)) {
      const secret = holder[field] as string;
      if (holder.ref && this.known.get(holder.ref) === secret) {
        delete holder[field];
        continue;
      }
      delete holder.ref;
      if (!chain) continue;
      const ref = randomUUID().replaceAll("-", "");
      try {
        chain.set(this.service, ref, secret);
      } catch (e) {
        this.warn(`the OS keychain refused a secret, keeping it in ${this.path}: ${(e as Error).message}`);
        continue;
      }
      this.known.set(ref, secret);
      holder.ref = ref;
      delete holder[field];
    }
    return stored;
  }

  private forget(gone: Iterable<string>): void {
    const chain = keychain.load();
    for (const ref of gone) {
      this.known.delete(ref);
      try {
        chain?.delete(this.service, ref);
      } catch (e) {
        this.warn(`cannot delete an old secret of ${this.path} from the OS keychain: ${(e as Error).message}`);
      }
    }
  }

  /** Read, change and write while holding the lock, so threads and processes saving at once all keep their edit. Nothing is written if change throws. */
  edit<T>(change: (data: KeyringData) => T): T {
    return this.exclusive(() => {
      const data = this.read();
      const before = refs(data);
      const result = change(data);
      const stored = this.stored(data);
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify(stored, null, 2), { mode: 0o600 });
      renameSync(tmp, this.path);
      // Only now does nothing point at the old ones.
      const after = refs(stored);
      this.forget([...before].filter((ref) => !after.has(ref)));
      return result;
    });
  }

  /** A directory as the lock, since mkdir either creates it or fails on every platform. */
  private exclusive<T>(run: () => T): T {
    const lock = `${this.path}.jslock`;
    for (;;) {
      try {
        mkdirSync(lock, { mode: 0o700 });
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        try {
          if (Date.now() - statSync(lock).mtimeMs > STALE_LOCK * 1000) rmdirSync(lock);
        } catch {
          // released or taken over meanwhile
        }
        sleepSync(10);
      }
    }
    try {
      return run();
    } finally {
      rmdirSync(lock);
    }
  }
}
