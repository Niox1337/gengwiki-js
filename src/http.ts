/** fetch with typed errors. Knows nothing about caching. */

import { isIPv4 } from "node:net";
import {
  AuthError,
  BadRequestError,
  BadResponseError,
  ConflictError,
  ForbiddenError,
  GengWikiError,
  NetworkError,
  NotFoundError,
  RateLimitError,
  ServerError,
  UnavailableError,
} from "./errors";
import { VERSION } from "./version";

const BY_STATUS: Record<number, typeof GengWikiError> = {
  400: BadRequestError,
  401: AuthError,
  403: ForbiddenError,
  404: NotFoundError,
  409: ConflictError,
};

/** Seconds before the first retry, doubling each try. Mutable so tests can shrink it. */
export const retry = { wait: 0.5 };

/** A JSON shape: a constructor for the type, [shape of every row] with one shape inside, or {field: shape} for the fields that must be there. */
export type Shape =
  | StringConstructor
  | NumberConstructor
  | BooleanConstructor
  | ArrayConstructor
  | ObjectConstructor
  | readonly Shape[]
  | { [field: string]: Shape };

export type Params = Record<string, string | number>;

export interface RequestOptions {
  token?: string | null;
  params?: Params;
  body?: unknown;
  retries?: number;
}

export interface Reply {
  body: Buffer;
  headers: Headers;
}

/** Bearer tokens only travel over HTTPS, plain HTTP is for a dev server on this machine. */
export function checkUrl(url: string): string {
  let parts: URL | null = null;
  try {
    parts = new URL(url);
  } catch {
    // reported below
  }
  if (parts?.hostname) {
    const host = parts.hostname;
    const loopback = host === "localhost" || host === "[::1]" || (isIPv4(host) && host.startsWith("127."));
    if (parts.protocol === "https:" || (parts.protocol === "http:" && loopback)) {
      return url.replace(/\/+$/, "");
    }
  }
  throw new TypeError(`${JSON.stringify(url)} must be https, or http on localhost`);
}

export function contentType(headers: Headers): string {
  return (headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
}

function errorFor(status: number, body: Buffer, headers: Headers): GengWikiError {
  let code: string | null = null;
  let message = `HTTP ${status}`;
  try {
    const err = JSON.parse(body.toString("utf8")).error;
    if (typeof err.code === "string" && typeof err.message === "string") {
      code = err.code;
      message = err.message;
    }
  } catch {
    // not the API's error format
  }
  if (status === 429) {
    const retryAfter = Number(headers.get("retry-after") ?? 0);
    return new RateLimitError(message, Number.isFinite(retryAfter) ? retryAfter : 0);
  }
  if (status >= 500) return new ServerError(message, status, code);
  const cls = BY_STATUS[status] ?? GengWikiError;
  return new cls(message, status, code);
}

export function fits(value: unknown, shape: Shape): boolean {
  if (Array.isArray(shape)) return Array.isArray(value) && value.every((row) => fits(row, shape[0]!));
  if (typeof shape === "function") {
    switch (shape) {
      case String:
        return typeof value === "string";
      case Number:
        return typeof value === "number";
      case Boolean:
        return typeof value === "boolean";
      case Array:
        return Array.isArray(value);
      default:
        return typeof value === "object" && value !== null && !Array.isArray(value);
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Object.entries(shape).every(([k, s]) => k in row && fits(row[k], s));
}

const sleep = (seconds: number) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

export class Http {
  /** Requests actually sent. */
  count = 0;

  /** timeout is in seconds. fetch pools connections on its own. */
  constructor(readonly timeout = 15) {}

  private async once(method: string, url: string, headers: Record<string, string>, data: Buffer | string | undefined): Promise<Reply> {
    this.count++;
    let res: Response;
    let body: Buffer;
    try {
      // A redirect would carry the Authorization header to wherever it points.
      res = await fetch(url, { method, headers, body: data, redirect: "manual", signal: AbortSignal.timeout(this.timeout * 1000) });
      body = Buffer.from(await res.arrayBuffer());
    } catch (e) {
      // A connection cut mid-response or a damaged body is the same outage to the caller.
      const cause = e instanceof Error ? ((e.cause as Error | undefined)?.message ?? e.message) : String(e);
      throw new NetworkError(`cannot reach ${new URL(url).host}: ${cause}`, null, null);
    }
    if (res.status < 200 || res.status >= 300) throw errorFor(res.status, body, res.headers);
    return { body, headers: res.headers };
  }

  async request(method: string, url: string, { token, params, body, retries = 0 }: RequestOptions = {}): Promise<Reply> {
    if (params && Object.keys(params).length) {
      url += "?" + new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)] as [string, string])).toString();
    }
    const headers: Record<string, string> = { "User-Agent": `gengwiki-js/${VERSION}` };
    if (token) headers.Authorization = `Bearer ${token}`;
    let data: Buffer | string | undefined;
    if (body instanceof Uint8Array) {
      data = Buffer.from(body);
      headers["Content-Type"] = "application/octet-stream";
    } else if (body !== undefined) {
      data = JSON.stringify(body);
      headers["Content-Type"] = "application/json";
    }
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.once(method, url, headers, data);
      } catch (e) {
        if (!(e instanceof UnavailableError)) throw e;
        // A long Retry-After is the daily limit, waiting it out would hang the caller.
        const wait = e instanceof RateLimitError ? e.retryAfter : retry.wait * 2 ** attempt;
        if (attempt >= retries || wait > 5) throw e;
        await sleep(wait);
      }
    }
  }

  /** The decoded body. With expect, anything but that shape is a bad response, so it never reaches the cache. */
  async json<T = any>(method: string, url: string, options: RequestOptions & { expect?: Shape } = {}): Promise<T> {
    const { body, headers } = await this.request(method, url, options);
    let value: unknown = null;
    if (body.length) {
      try {
        value = JSON.parse(body.toString("utf8"));
      } catch {
        throw new BadResponseError(`expected JSON from ${url}, got ${contentType(headers) || "no content type"}`, null, "bad_response");
      }
    }
    if (options.expect && !fits(value, options.expect)) {
      throw new BadResponseError(`unexpected JSON from ${url}`, null, "bad_response");
    }
    return value as T;
  }
}
