import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AuthError, BadResponseError, GengWikiError, NetworkError, RateLimitError, ServerError } from "../src/errors";
import { Http, checkUrl, fits, retry } from "../src/http";

let handle: (req: IncomingMessage, res: ServerResponse) => void;
let hits = 0;
let base = "";
const server = createServer((req, res) => {
  hits++;
  handle(req, res);
});

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  retry.wait = 0.01;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  hits = 0;
});

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => (_: IncomingMessage, res: ServerResponse) => {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};

describe("checkUrl", () => {
  it("takes https anywhere and http only on this machine", () => {
    expect(checkUrl("https://api.gengwiki.com/")).toBe("https://api.gengwiki.com");
    expect(checkUrl("http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
    expect(checkUrl("http://localhost:3000")).toBe("http://localhost:3000");
    expect(checkUrl("http://[::1]:3000")).toBe("http://[::1]:3000");
    expect(() => checkUrl("http://gengwiki.com")).toThrow(TypeError);
    expect(() => checkUrl("not a url")).toThrow(TypeError);
  });
});

describe("fits", () => {
  it("checks the fields that must be there and ignores the rest", () => {
    const shape = [{ slug: String, aliases: Array, heat: Number }];
    expect(fits([{ slug: "a", aliases: [], heat: 1, extra: null }], shape)).toBe(true);
    expect(fits([{ slug: "a", aliases: [] }], shape)).toBe(false);
    expect(fits({ slug: "a" }, shape)).toBe(false);
    expect(fits({ a: 1 }, Object)).toBe(true);
    expect(fits([], Object)).toBe(false);
  });
});

describe("Http", () => {
  it("maps statuses to errors with the API's code and message", async () => {
    handle = json(401, { error: { code: "unauthorized", message: "bad key" } });
    const err = await new Http().json("GET", base).catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect([err.status, err.code, err.message]).toEqual([401, "unauthorized", "bad key"]);
  });

  it("does not follow a redirect", async () => {
    handle = (_, res) => {
      res.writeHead(302, { Location: "https://example.com" });
      res.end();
    };
    const err = await new Http().json("GET", base, { token: "secret" }).catch((e) => e);
    expect(err).toBeInstanceOf(GengWikiError);
    expect(err.status).toBe(302);
  });

  it("retries an outage and gives up after the retries", async () => {
    handle = json(503, {});
    await expect(new Http().json("GET", base, { retries: 2 })).rejects.toBeInstanceOf(ServerError);
    expect(hits).toBe(3);
  });

  it("does not wait out a long Retry-After", async () => {
    handle = json(429, { error: { code: "rate_limited", message: "x" } }, { "Retry-After": "3600" });
    const err = await new Http().json("GET", base, { retries: 3 }).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.retryAfter).toBe(3600);
    expect(hits).toBe(1);
  });

  it("treats a 200 that is not JSON, or the wrong JSON, as a bad response", async () => {
    handle = (_, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html>登录 Wi-Fi</html>");
    };
    await expect(new Http().json("GET", base)).rejects.toBeInstanceOf(BadResponseError);
    handle = json(200, { not: "a list" });
    await expect(new Http().json("GET", base, { expect: [Object] })).rejects.toBeInstanceOf(BadResponseError);
  });

  it("reads a gzip body and sends the key, the query and a JSON body", async () => {
    let seen: { auth?: string; url?: string; body?: string } = {};
    handle = (req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen = { auth: req.headers.authorization, url: req.url, body };
        res.writeHead(200, { "Content-Type": "application/json", "Content-Encoding": "gzip" });
        res.end(gzipSync(JSON.stringify({ ok: "躺平" })));
      });
    };
    const got = await new Http().json("POST", base + "/x", { token: "k", params: { q: "躺 平", limit: 5 }, body: { a: 1 } });
    expect(got).toEqual({ ok: "躺平" });
    expect(seen).toEqual({ auth: "Bearer k", url: "/x?q=%E8%BA%BA+%E5%B9%B3&limit=5", body: '{"a":1}' });
  });

  it("reports a closed port as a network failure", async () => {
    await expect(new Http(1).json("GET", "http://127.0.0.1:1")).rejects.toBeInstanceOf(NetworkError);
  });
});
