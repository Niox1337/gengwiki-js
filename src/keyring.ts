/**
 * Saved API keys, the login token and subscribed tags, in one JSON file only this user can read.
 * The format is the Python SDK's, so both read the keys the other saved.
 */

import { mkdirSync, readFileSync, realpathSync, renameSync, rmdirSync, statSync, writeFileSync } from "node:fs";
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

/** Seconds after which a lock left by a crashed process is taken over. */
const STALE_LOCK = 10;

const pause = new Int32Array(new SharedArrayBuffer(4));
const sleepSync = (ms: number) => Atomics.wait(pause, 0, 0, ms);

export class Keyring {
  readonly service: string;

  constructor(readonly path: string) {
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
    return data;
  }

  /** Read, change and write while holding the lock, so threads and processes saving at once all keep their edit. Nothing is written if change throws. */
  edit<T>(change: (data: KeyringData) => T): T {
    return this.exclusive(() => {
      const data = this.read();
      const result = change(data);
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
      renameSync(tmp, this.path);
      return result;
    });
  }

  /** A directory as the lock, since mkdir either creates it or fails on every platform. The Python SDK locks a different file. */
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
