import { describe, expect, it } from "vitest";
import { isShareId, SHARE_ID_ALPHABET } from "@automatalab/core/worksheet/shareLink";
import { newSnapshotId, shareUrl } from "./snapshot";

/** randomness that hands out the given bytes in order, as many as asked */
function bytes(...values: number[]) {
  let i = 0;
  return (n: number) => Uint8Array.from({ length: n }, () => values[i++ % values.length]);
}

describe("a new snapshot id", () => {
  it("maps each byte to a letter by its remainder", () => {
    expect(newSnapshotId(bytes(0, 1, 2, 3, 4, 5, 6, 7, 8, 9))).toBe("abcdefghij");
    expect(newSnapshotId(bytes(35, 36, 71, 251))).toBe("9a99" + "9a99" + "9a");
  });

  it("drops the bytes 252–255, which would make the first four letters likelier", () => {
    expect(newSnapshotId(bytes(252, 253, 254, 255, 25))).toBe("zzzzzzzzzz");
  });

  it("asks for more bytes while too many were dropped", () => {
    let calls = 0;
    const rnd = (n: number) => {
      calls++;
      return Uint8Array.from({ length: n }, (_, i) => (calls === 1 ? 255 : i));
    };
    expect(newSnapshotId(rnd)).toBe("abcdefghij");
    expect(calls).toBe(2);
  });

  it("is a share id with every letter equally likely", () => {
    const counts = new Map<string, number>();
    let seed = 12345;
    // a small linear congruential generator: deterministic, and covers every byte value
    const rnd = (n: number) =>
      Uint8Array.from({ length: n }, () => (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24);
    for (let k = 0; k < 3600; k++) {
      const id = newSnapshotId(rnd);
      expect(isShareId(id)).toBe(true);
      for (const ch of id) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
    expect([...counts.keys()].sort().join("")).toBe([...SHARE_ID_ALPHABET].sort().join(""));
    // 36 000 letters, 1000 expected each: every count within 15 %
    for (const [ch, c] of counts) expect(Math.abs(c - 1000), ch).toBeLessThan(150);
  });
});

describe("a share url", () => {
  it("is the app's address, /w/ and the id", () => {
    expect(shareUrl("https://automatalab.app", "k3x9pq2mzt")).toBe("https://automatalab.app/w/k3x9pq2mzt");
    expect(shareUrl("https://automatalab.app/", "k3x9pq2mzt")).toBe("https://automatalab.app/w/k3x9pq2mzt");
    expect(shareUrl("http://localhost:5173//", "k3x9pq2mzt")).toBe("http://localhost:5173/w/k3x9pq2mzt");
  });
});
