import { useEffect, useRef, type RefObject } from "react";

/**
 * Attaches a native, non-passive `wheel` listener directly to `ref`'s
 * element, bypassing React's synthetic `onWheel` prop entirely.
 *
 * React (since v17) registers its root-level delegated `wheel`/`touchstart`/
 * `touchmove` listeners with `{ passive: true }`, for scroll performance --
 * confirmed against the installed `react-dom` build's own
 * `addTrappedEventListener` (it explicitly marks exactly these three event
 * names passive). That means `event.preventDefault()` called from inside a
 * React `onWheel` handler is a silent no-op: the browser still scrolls the
 * page underneath the canvas at the same time the handler zooms it, even
 * though the handler *looks* like it's stopping that. Every wheel-to-zoom
 * canvas in this app called `preventDefault()` for exactly that reason and
 * it never actually worked -- scrolling over a graph zoomed the graph AND
 * scrolled the page simultaneously. A plain `element.addEventListener(...,
 * { passive: false })`, which this hook wraps, is the only way to get a
 * `wheel` listener whose `preventDefault()` genuinely stops page scroll.
 *
 * `handler` is stored in a ref and always invoked fresh (not memoized or
 * dependency-tracked) -- callers pass an inline closure that reads live
 * state every render, same ergonomics as the React `onWheel` prop it
 * replaces, without needing `useCallback` to avoid tearing down and
 * re-attaching the listener on every render.
 */
export function useNonPassiveWheel<T extends HTMLElement>(ref: RefObject<T | null>, handler: (e: WheelEvent) => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      handlerRef.current(e);
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ref]);
}
