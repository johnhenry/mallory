/**
 * Resolved theme colors for Canvas2D drawing. Canvas2D's `fillStyle`/
 * `strokeStyle` need a real computed color string -- unlike a DOM element's
 * `style.border`, they do NOT accept a raw `"var(--ink)"` CSS custom-
 * property reference -- so any canvas text/label color that should adapt to
 * the light/dark theme toggle (`public/styles.css`'s `:root[data-theme]`
 * blocks) has to read the property's current resolved value instead.
 *
 * Reads once per call (not cached/memoized): the theme can change at
 * runtime via the toggle, and this is only ever called from inside a
 * canvas-drawing `useEffect` (cheap relative to the sampling/rendering work
 * already happening there).
 */
export interface ThemeColors {
  ink: string;
  inkSoft: string;
  muted: string;
}

const FALLBACK: ThemeColors = { ink: "#1c2531", inkSoft: "#47536b", muted: "#64748b" };

/** Falls back to the light-theme palette when `document` isn't available (SSR) or a variable isn't set. */
export function getThemeColors(): ThemeColors {
  if (typeof document === "undefined") return FALLBACK;
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => {
    const value = style.getPropertyValue(name).trim();
    return value.length > 0 ? value : fallback;
  };
  return {
    ink: read("--ink", FALLBACK.ink),
    inkSoft: read("--ink-soft", FALLBACK.inkSoft),
    muted: read("--muted", FALLBACK.muted),
  };
}
