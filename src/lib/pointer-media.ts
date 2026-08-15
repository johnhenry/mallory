/**
 * Whether the primary pointing device is coarse (touch/stylus without
 * hover, per the CSS `pointer` media feature) rather than fine (mouse/
 * trackpad) -- issue #53's "larger hit target on coarse pointers" item.
 * A touch tap lands within a much bigger, less precise area than a mouse
 * click, so hit-radius constants tuned for a cursor (annotation dragging,
 * "Read point" nearest-curve search) are too tight on a phone/tablet.
 *
 * SSR/no-DOM-safe: false when `window`/`matchMedia` aren't available,
 * matching `theme-colors.ts`'s `getThemeColors` fallback convention.
 */
export function isCoarsePointer(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(pointer: coarse)").matches;
}

/**
 * How much wider a hit-radius constant gets on a coarse pointer -- the
 * factor #106 (GraphCanvasMulti's annotation-drag/"Read point" widening)
 * established empirically. Shared here (rather than each caller re-picking
 * its own number) so every panel's touch hit-target widening stays
 * consistent as more panels adopt it (#53's remaining "roll out" item).
 */
export const COARSE_POINTER_HIT_RADIUS_MULTIPLIER = 2.5;
