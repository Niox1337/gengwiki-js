import { describe, expect, it } from "vitest";
import { GengWikiError, NetworkError, RateLimitError, UnavailableError } from "../src/errors";

describe("errors", () => {
  it("keeps the class name, status and code", () => {
    const e = new NetworkError("down", null, "network");
    expect(e).toBeInstanceOf(UnavailableError);
    expect(e).toBeInstanceOf(GengWikiError);
    expect(e.name).toBe("NetworkError");
    expect(e.code).toBe("network");
  });

  it("defaults a rate limit to 429", () => {
    const e = new RateLimitError("slow down", 3);
    expect([e.status, e.code, e.retryAfter]).toEqual([429, "rate_limited", 3]);
  });
});
