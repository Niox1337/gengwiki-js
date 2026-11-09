import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import { GengWiki, type GengWikiOptions } from "../src/client";
import { retry } from "../src/http";
import { Fake, KEY_A, serve } from "./fake";

retry.wait = 0.01;

const quiet = { warn: () => {} };

/** A fresh fake service, home folder and client factory for every test. */
export function setup() {
  const ctx = {
    fake: new Fake(),
    url: "",
    dir: "",
    client(key: string | null = KEY_A, options: Partial<GengWikiOptions> & Record<string, unknown> = {}): GengWiki {
      const c = new GengWiki({ apiKey: key ?? undefined, baseUrl: ctx.url, siteUrl: ctx.url, home: ctx.dir, logger: quiet, ...options });
      clients.push(c);
      return c;
    },
  };
  const clients: GengWiki[] = [];
  let stop = async () => {};
  beforeEach(async () => {
    ctx.fake = new Fake();
    ctx.dir = mkdtempSync(join(tmpdir(), "gengwiki-"));
    ({ url: ctx.url, stop } = await serve(ctx.fake));
    delete process.env.GENGWIKI_API_KEY;
  });
  afterEach(async () => {
    for (const c of clients.splice(0)) c.close();
    await stop();
  });
  return ctx;
}
