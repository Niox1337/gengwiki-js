/** SQLite cache of raw API responses. A cache must never break the caller, so its failures read as misses. */

import { createHash } from "node:crypto";
import { rmSync } from "node:fs";

// The table name carries the format version, a new format simply starts empty. The same file works for the Python SDK.
const SCHEMA = "create table if not exists cache_v1 (ns text, key text, value text, fetched_at real, primary key (ns, key))";

/** Cache rows are filed under a hash, the key itself never reaches the cache. */
export function namespace(key: string | null | undefined): string {
  return createHash("sha256")
    .update(key ?? "")
    .digest("hex")
    .slice(0, 16);
}

export interface Hit {
  value: any;
  /** Seconds since it was fetched. */
  age: number;
}

const now = () => Date.now() / 1000;

interface Statement {
  get(...args: unknown[]): unknown;
  run(...args: unknown[]): unknown;
}

interface Database {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
}

type DatabaseClass = new (path: string) => Database;

/** node:sqlite, or null on a Node without it. */
function sqlite(): DatabaseClass | null {
  try {
    return (process.getBuiltinModule("node:sqlite") as { DatabaseSync: DatabaseClass } | undefined)?.DatabaseSync ?? null;
  } catch {
    return null;
  }
}

function connect(cls: DatabaseClass, path: string): Database {
  const db = new cls(path);
  try {
    // The busy timeout covers several processes sharing one cache.
    db.exec("pragma busy_timeout = 5000");
    db.exec("pragma journal_mode = wal");
    db.exec(SCHEMA);
  } catch (e) {
    db.close();
    throw e;
  }
  return db;
}

export class Store {
  private db: Database | null = null;
  private memory = new Map<string, { value: string; fetched_at: number }>();
  private closed = false;

  constructor(path: string, onWarning: (message: string) => void = () => {}) {
    const cls = sqlite();
    if (cls === null) {
      onWarning(`node:sqlite is missing on Node ${process.version}, caching in memory only`);
      return;
    }
    try {
      this.db = connect(cls, path);
    } catch {
      // Corrupt or read-only. Nothing in here is precious, start over and stay in memory if the disk refuses.
      try {
        rmSync(path, { force: true });
        this.db = connect(cls, path);
      } catch (e) {
        onWarning(`cannot open ${path}, caching in memory only: ${e}`);
        this.db = connect(cls, ":memory:");
      }
    }
  }

  get(ns: string, key: string): Hit | null {
    if (this.closed) return null;
    try {
      let row: { value: string; fetched_at: number } | undefined;
      if (this.db) {
        row = this.db.prepare("select value, fetched_at from cache_v1 where ns = ? and key = ?").get(ns, key) as typeof row;
      } else {
        row = this.memory.get(`${ns}\0${key}`);
      }
      return row ? { value: JSON.parse(row.value), age: now() - row.fetched_at } : null;
    } catch {
      return null;
    }
  }

  put(ns: string, key: string, value: unknown): void {
    if (this.closed) return;
    const text = JSON.stringify(value);
    if (!this.db) {
      this.memory.set(`${ns}\0${key}`, { value: text, fetched_at: now() });
      return;
    }
    this.run("insert or replace into cache_v1 values (?, ?, ?, ?)", ns, key, text, now());
  }

  /** Keep the rows as a fallback, but make the next read go to the network. */
  expire(ns: string): void {
    if (this.closed) return;
    if (!this.db) {
      for (const [k, row] of this.memory) if (k.startsWith(`${ns}\0`)) row.fetched_at = 0;
      return;
    }
    this.run("update cache_v1 set fetched_at = 0 where ns = ?", ns);
  }

  drop(ns: string): void {
    if (this.closed) return;
    if (!this.db) {
      for (const k of [...this.memory.keys()]) if (k.startsWith(`${ns}\0`)) this.memory.delete(k);
      return;
    }
    this.run("delete from cache_v1 where ns = ?", ns);
  }

  rename(old: string, renamed: string): void {
    if (this.closed) return;
    if (!this.db) {
      for (const [k, row] of [...this.memory]) {
        if (!k.startsWith(`${old}\0`)) continue;
        this.memory.delete(k);
        this.memory.set(renamed + k.slice(old.length), row);
      }
      return;
    }
    this.run("update cache_v1 set ns = ? where ns = ?", renamed, old);
  }

  private run(sql: string, ...args: unknown[]): void {
    if (this.closed) return;
    try {
      this.db!.prepare(sql).run(...args);
    } catch {
      // a lost write is only a later miss
    }
  }

  close(): void {
    try {
      this.db?.close();
    } catch {
      // already closed
    }
    this.db = null;
    this.closed = true;
  }
}
