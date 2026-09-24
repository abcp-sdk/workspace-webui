// PageDataCache — a read-through cache for page data, keyed by a string
// (usually `page.key` plus a slice name).
//
// WHY: a page's data effect re-runs whenever its pane SLIDES in the forest
// window (`[a,b] → [b,c]` moves the retained pane from the right column to the
// left; the component INSTANCE persists, but its `$effect` re-runs). Without a
// cache that re-run refetches everything. With one, a slide is a cache HIT: no
// request, no flicker. Only the FIRST visit (or an explicit Refresh →
// `drop`) fetches.
//
// Deliberately NOT reactive: pages keep their own reactive `$state` copies, so
// the cache only needs synchronous read/write + in-flight dedup.
export class PageDataCache {
  private data = new Map<string, unknown>()
  private inflight = new Map<string, Promise<unknown>>()

  /** Cached value for `key`, or undefined when absent. */
  get<T>(key: string): T | undefined {
    return this.data.get(key) as T | undefined
  }

  has(key: string): boolean {
    return this.data.has(key)
  }

  /** Store a value directly (e.g. after a mutation updated it in place). */
  set(key: string, value: unknown): void {
    this.data.set(key, value)
  }

  /**
   * Read-through: the cached value, else run `load` ONCE (concurrent callers
   * share the in-flight promise) and cache the result. A rejected load is NOT
   * cached, so the next call retries.
   */
  load<T>(key: string, load: () => Promise<T>): Promise<T> {
    if (this.data.has(key)) return Promise.resolve(this.data.get(key) as T)
    const existing = this.inflight.get(key)
    if (existing) return existing as Promise<T>
    const p = load()
      .then(v => {
        this.data.set(key, v)
        return v
      })
      .finally(() => {
        this.inflight.delete(key)
      })
    this.inflight.set(key, p)
    return p
  }

  /** Force the next read of `key` to refetch. */
  drop(key: string): void {
    this.data.delete(key)
    this.inflight.delete(key)
  }

  /** Drop every entry whose key starts with `prefix`. */
  dropPrefix(prefix: string): void {
    for (const k of [...this.data.keys()])
      if (k.startsWith(prefix)) this.data.delete(k)
    for (const k of [...this.inflight.keys()])
      if (k.startsWith(prefix)) this.inflight.delete(k)
  }
}
