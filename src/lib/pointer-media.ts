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
