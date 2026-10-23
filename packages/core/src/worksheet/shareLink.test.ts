import { describe, expect, it } from "vitest";
import { isShareId, SHARE_ID_ALPHABET, SHARE_ID_LENGTH, shareIdFrom, sharePath } from "./shareLink";

describe("a share link", () => {
  it("ends in ten lower-case letters and digits", () => {
    expect(SHARE_ID_ALPHABET).toHaveLength(36);
    expect(new Set(SHARE_ID_ALPHABET).size).toBe(36);
    expect(SHARE_ID_LENGTH).toBe(10);
    expect(isShareId("k3x9pq2mzt")).toBe(true);
    for (const bad of ["", "k3x9pq2mz", "k3x9pq2mzt0", "K3x9pq2mzt", "k3x9pq2mz_", "k3x9pq2mz ", "ő3x9pq2mzt"])
      expect(isShareId(bad), bad).toBe(false);
  });

  it("opens the page /w/<id>", () => {
    expect(sharePath("k3x9pq2mzt")).toBe("/w/k3x9pq2mzt");
  });

  it("gives its id back from a whole link, a path or the id itself", () => {
    for (const link of [
      "https://automatalab.app/w/k3x9pq2mzt",
      "https://automatalab.app/w/k3x9pq2mzt/",
      "https://automatalab.app/w/k3x9pq2mzt?embed",
      "http://localhost:5173/w/k3x9pq2mzt#top",
      "automatalab.app/w/k3x9pq2mzt",
      "/w/k3x9pq2mzt",
      "  k3x9pq2mzt  "
    ])
      expect(shareIdFrom(link), link).toBe("k3x9pq2mzt");
  });

  it("finds no id where there is none", () => {
    for (const link of [
      "",
      "/",
      "/w/",
      "/w/short",
      "/w/k3x9pq2mzt0",
      "/w/K3X9PQ2MZT",
      "/x/k3x9pq2mzt",
      "https://automatalab.app/w/k3x9pq2mzt/more",
      "https://automatalab.app/"
    ])
      expect(shareIdFrom(link), link).toBeNull();
  });
});
