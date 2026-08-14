export interface MemoizeLruOptions {
  /** Entries beyond this count get evicted, least-recently-used first. Default 20. */
  maxSize?: number;
}

/**
 * Wraps a pure function in a least-recently-used cache keyed by
 * `JSON.stringify(args)` -- built for `sampleExprAdaptive` (issue #52's
 * "memoization audit" work item), where `CellGraph`'s own dependency
 * tracking already avoids a redundant call when nothing changed, but has no
 * memory of a PAST call: panning back to an exact previous viewport (e.g.
 * a double-click reset) is a genuine dependency change from `CellGraph`'s
 * point of view, so it re-triggers a from-scratch resample even though the
 * result would be identical to one already computed a moment ago. This
 * closes exactly that gap, with no change needed at any call site.
 *
 * `Map` iterates insertion order, so re-inserting a hit (delete then set)
 * is what keeps recency order correct for LRU eviction -- the same
 * technique this codebase already uses for the on-DOM download-anchor
 * pattern elsewhere, applied here to cache recency instead.
 *
 * Known limitation, not solved generally (real call-site args don't hit
 * it): `JSON.stringify` collapses `NaN`/`undefined`/`Infinity` in ways that
 * could make genuinely different inputs collide on the same key (e.g.
 * `NaN` and `null` both stringify to `null`) -- fine for `sampleExprAdaptive`,
 * whose args are always finite numbers/strings/plain param objects, but not
 * a safe general-purpose cache key strategy beyond that.
 */
export function memoizeLru<Args extends unknown[], R>(fn: (...args: Args) => R, options: MemoizeLruOptions = {}): (...args: Args) => R {
  const maxSize = options.maxSize ?? 20;
  const cache = new Map<string, R>();
  return (...args: Args): R => {
    const key = JSON.stringify(args);
    if (cache.has(key)) {
      const value = cache.get(key) as R;
      cache.delete(key);
      cache.set(key, value);
      return value;
    }
    const value = fn(...args);
    cache.set(key, value);
    if (cache.size > maxSize) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey !== undefined) cache.delete(oldestKey);
    }
    return value;
  };
}
