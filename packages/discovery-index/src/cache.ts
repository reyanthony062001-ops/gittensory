// A small in-memory TTL cache. This service intentionally carries no Redis dependency (matching
// review-enrichment/'s own dependency set), and the repo's real TTL/expiry caches
// (src/selfhost/redis-cache.ts) live in the main Cloudflare Worker package and aren't importable from a
// separate npm workspace package — there's no in-repo precedent for a plain in-memory keyed-with-expiry
// cache, so this is net new, kept deliberately small (lazy expiry check on read, no background sweep;
// entries this service caches — GitHub issue metadata — are cheap to recompute on a stale miss).

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export class TtlCache<V> {
  private readonly store = new Map<string, Entry<V>>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Returns the cached value, or undefined if absent or expired (an expired entry is evicted on read). */
  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: this.now() + Math.max(0, ttlMs) });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  /** Get-or-compute: returns the live cached value, or awaits `compute()`, caches it, and returns it. */
  async getOrCompute(key: string, ttlMs: number, compute: () => Promise<V>): Promise<V> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const computed = await compute();
    this.set(key, computed, ttlMs);
    return computed;
  }

  /** Test/introspection only: number of entries currently stored, including not-yet-lazily-evicted ones. */
  get size(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }
}
