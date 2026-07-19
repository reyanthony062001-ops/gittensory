import { describe, expect, it } from "vitest";
import { TtlCache } from "../../../packages/discovery-index/src/cache";

function clock(startMs = 0) {
  let now = startMs;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe("discovery-index TtlCache (#7164)", () => {
  it("returns undefined for an absent key", () => {
    const cache = new TtlCache<string>();
    expect(cache.get("missing")).toBeUndefined();
  });

  it("returns a set value before expiry, and evicts it after", () => {
    const c = clock();
    const cache = new TtlCache<string>(c.now);
    cache.set("k", "v", 100);
    expect(cache.get("k")).toBe("v");
    expect(cache.size).toBe(1);
    c.advance(101);
    expect(cache.get("k")).toBeUndefined();
    expect(cache.size).toBe(0); // lazily evicted on read
  });

  it("clamps a negative ttl to immediate expiry", () => {
    const cache = new TtlCache<string>();
    cache.set("k", "v", -50);
    expect(cache.get("k")).toBeUndefined();
  });

  it("delete removes a key and clear empties the store", () => {
    const cache = new TtlCache<string>();
    cache.set("a", "1", 1000);
    cache.set("b", "2", 1000);
    cache.delete("a");
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("2");
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("getOrCompute computes and caches on miss, and skips compute on hit", async () => {
    const cache = new TtlCache<number>();
    let calls = 0;
    const compute = async () => {
      calls += 1;
      return 42;
    };
    expect(await cache.getOrCompute("k", 1000, compute)).toBe(42);
    expect(await cache.getOrCompute("k", 1000, compute)).toBe(42);
    expect(calls).toBe(1);
  });

  it("getOrCompute recomputes after the cached value expires", async () => {
    const c = clock();
    const cache = new TtlCache<number>(c.now);
    let calls = 0;
    const compute = async () => {
      calls += 1;
      return calls;
    };
    expect(await cache.getOrCompute("k", 100, compute)).toBe(1);
    c.advance(101);
    expect(await cache.getOrCompute("k", 100, compute)).toBe(2);
    expect(calls).toBe(2);
  });
});
