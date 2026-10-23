import { describe, expect, it } from "vitest";
import { windowRateLimiter } from "./rateLimiter";

function limiter(perKey: number, total: number) {
  let t = 0;
  const warnings: string[] = [];
  const l = windowRateLimiter({
    perKey: { limit: perKey, ms: 60_000 },
    total: { limit: total, ms: 3_600_000 },
    log: { warn: (m) => warnings.push(m) },
    now: () => t
  });
  return { take: (k: string) => l.take(k), at: (ms: number) => void (t = ms), warnings };
}

describe("the rate limiter", () => {
  it("lets a key make `limit` requests in its window, then says when to come back", () => {
    const l = limiter(3, 100);
    expect([1, 2, 3].map(() => l.take("a").ok)).toEqual([true, true, true]);
    l.at(20_000);
    expect(l.take("a")).toEqual({ ok: false, retryAfterSeconds: 40 });
    l.at(59_999);
    expect(l.take("a")).toEqual({ ok: false, retryAfterSeconds: 1 });
    l.at(60_000);
    expect(l.take("a")).toEqual({ ok: true });
  });

  it("counts every key on its own", () => {
    const l = limiter(1, 100);
    expect(l.take("a").ok).toBe(true);
    expect(l.take("b").ok).toBe(true);
    expect(l.take("a").ok).toBe(false);
    expect(l.take("b").ok).toBe(false);
  });

  it("caps all keys together, whatever address they come from", () => {
    const l = limiter(10, 3);
    expect(["a", "b", "c"].map((k) => l.take(k).ok)).toEqual([true, true, true]);
    l.at(600_000);
    expect(l.take("d")).toEqual({ ok: false, retryAfterSeconds: 3000 });
    l.at(3_600_000);
    expect(l.take("d").ok).toBe(true);
  });

  it("a refused request does not count", () => {
    const l = limiter(1, 2);
    l.take("a");
    for (let i = 0; i < 5; i++) expect(l.take("a").ok).toBe(false);
    expect(l.take("b").ok).toBe(true);
  });

  it("logs the first refusal of a key's window, and no more until its next window", () => {
    const l = limiter(2, 100);
    l.take("1.2.3.4");
    l.take("1.2.3.4");
    expect(l.warnings).toEqual([]);
    l.at(15_000);
    for (let i = 0; i < 5; i++) l.take("1.2.3.4");
    expect(l.warnings).toEqual(["rate limit: 1.2.3.4 made 2 requests in 1 min; refused for 45 s"]);
    l.at(60_000);
    l.take("1.2.3.4");
    l.take("1.2.3.4");
    l.take("1.2.3.4");
    expect(l.warnings).toHaveLength(2);
  });

  it("logs every key that reaches its limit on its own", () => {
    const l = limiter(1, 100);
    for (const k of ["a", "a", "a", "b", "b"]) l.take(k);
    expect(l.warnings).toEqual([
      "rate limit: a made 1 requests in 1 min; refused for 60 s",
      "rate limit: b made 1 requests in 1 min; refused for 60 s"
    ]);
  });

  it("logs the first refusal of the total window once, whoever is refused", () => {
    const l = limiter(10, 2);
    for (const k of ["a", "b", "c", "d", "c"]) l.take(k);
    expect(l.warnings).toEqual(["rate limit: 2 requests from everyone together in 60 min; all refused for 3600 s"]);
    l.at(3_600_000);
    for (const k of ["a", "b", "c"]) l.take(k);
    expect(l.warnings).toHaveLength(2);
  });
});
