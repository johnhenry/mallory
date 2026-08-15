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
  /** The panel background color -- what Three.js scenes (see `subscribeToThemeChange` below) use for `scene.background`. */
  surface: string;
}

const FALLBACK: ThemeColors = { ink: "#1c2531", inkSoft: "#47536b", muted: "#64748b", surface: "#ffffff" };

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
    surface: read("--surface", FALLBACK.surface),
  };
}

/**
 * Notifies `onChange` whenever the resolved theme might have flipped --
 * either the explicit toggle (`_app.tsx` sets/clears `data-theme` on
 * `<html>`; observed here via `MutationObserver`) or the OS-level color
 * scheme changing while the shell is in "auto" mode (no `data-theme` set,
 * `prefers-color-scheme` driving `styles.css` directly -- a change
 * `MutationObserver` can't see, so `matchMedia`'s own `"change"` event
 * covers it).
 *
 * Exists for Three.js scenes (`Graph3DCanvas`, `ParametricSurfacePanel`):
 * `scene.background` is plain runtime state set once at mount, not CSS, so
 * unlike a DOM element styled with `var(--surface)` nothing re-applies it
 * automatically when the theme changes -- the caller has to re-read
 * `getThemeColors()` and re-set it itself.
 *
 * SSR/no-DOM-safe: returns a no-op unsubscribe when `document` isn't available.
 */
export function subscribeToThemeChange(onChange: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", onChange);
  };
}
