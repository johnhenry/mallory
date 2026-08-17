/**
 * Behavioral test for TaylorPanel's `committedViewport` memoization (issue
 * #236): unlike GraphCanvas/FourierPanel/ParametricPanel (which each cache
 * their viewport as a single CellGraph cell, giving it a stable reference
 * for free), TaylorPanel builds `committedViewport` from four separate
 * x/y-min/max cells inline in the render body. Before the fix that was a
 * brand-new object on every render, which defeated the draw effect's own
 * `[approx, viewport]` dependency check and redrew both curves (the f(x)
 * and Taylor-polynomial paths) on every unrelated re-render.
 *
 * `drawAxes`/`drawPath` (from ../lib/render-path.ts) are mocked to spies
 * that still delegate to the real implementation, so the test observes
 * exactly "did the draw effect body run again" without needing a real
 * Canvas2D backend (happy-dom's `canvas.getContext("2d")` returns `null`
 * -- no canvas backend is installed -- so the *unmocked* draw effect would
 * bail out via its own `if (!ctx) return` before calling either function,
 * making the redundant-redraw bug unobservable). A minimal permissive
 * proxy stands in for the 2D context so the real drawAxes/drawPath bodies
 * (which read `getComputedStyle`-derived theme colors, hence that global
 * is wired up too) can run to completion without throwing.
 *
 * mock.module (not mock.method) is required here because drawAxes/drawPath
 * are bare named function exports, not methods on a shared object.
 *
 * Same happy-dom + React 19 `act()` harness as use-cell.test.ts.
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { Window } from "happy-dom";

const domWindow = new Window();
(globalThis as Record<string, unknown>).window = domWindow;
(globalThis as Record<string, unknown>).document = domWindow.document;
(globalThis as Record<string, unknown>).getComputedStyle = domWindow.getComputedStyle.bind(domWindow);
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** Permissive fake Canvas2D context: any property read returns a no-op function, any write is stored. */
function fakeCtx(): unknown {
  const store: Record<string, unknown> = {};
  return new Proxy(store, {
    get(target, prop) {
      if (prop in target) return target[prop as string];
      return () => {};
    },
    set(target, prop, value) {
      target[prop as string] = value;
      return true;
    },
  });
}
(domWindow.HTMLCanvasElement.prototype as unknown as { getContext: () => unknown }).getContext = () => fakeCtx();

const realRenderPath = await import("../lib/render-path.ts");
const drawAxesSpy = mock.fn(realRenderPath.drawAxes);
const drawPathSpy = mock.fn(realRenderPath.drawPath);
mock.module("../lib/render-path.ts", {
  namedExports: { ...realRenderPath, drawAxes: drawAxesSpy, drawPath: drawPathSpy },
});

const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
// A component whose props parameter has a default value (`= {}`, as
// TaylorPanel's does) type-checks oddly against createElement's own
// overloads once obtained via `await import(...)` -- explicitly retyped to
// sidestep that (see RegressionPanel-render.test.ts's identical note).
const TaylorPanel = (await import("./TaylorPanel.tsx")).TaylorPanel as unknown as (props: {
  cellId?: string;
}) => ReturnType<typeof createElement>;

async function mount(element: ReturnType<typeof createElement>) {
  const container = domWindow.document.createElement("div");
  domWindow.document.body.appendChild(container as never);
  const root = createRoot(container as unknown as Element);
  await act(async () => {
    root.render(element);
  });
  return {
    container,
    update: (fn: () => void) => act(async () => fn()),
    unmount: () => act(async () => root.unmount()),
  };
}

/** Sets an <input>'s value via React's own tracked native setter (bypassing React's dirty-check) then fires a real `input` event, exactly what a user typing would produce. */
function setNativeValue(el: HTMLInputElement, value: string): void {
  const proto = Object.getPrototypeOf(el) as object;
  const desc = Object.getOwnPropertyDescriptor(proto, "value")!;
  desc.set!.call(el, value);
  el.dispatchEvent(new domWindow.Event("input", { bubbles: true }) as unknown as Event);
}

test("TaylorPanel: an unrelated input change does not redraw the canvas, but changing a viewport bound does", async () => {
  const { container, update, unmount } = await mount(createElement(TaylorPanel, { cellId: "taylor-render-test-1" }));
  const afterMount = drawAxesSpy.mock.callCount();
  assert.equal(afterMount, 1, "expected exactly one draw on mount");

  // Field order in the JSX: f(x), center, order, xMin, xMax, yMin, yMax, limitPoint.
  // happy-dom's own HTMLInputElement type doesn't structurally match lib.dom.d.ts's
  // (see setNativeValue's use below) -- route through `unknown` same as elsewhere.
  const inputs = [...container.querySelectorAll("input")] as unknown as HTMLInputElement[];
  const xMinInput = inputs[3]!;
  const limitPointInput = inputs[7]!;

  // Irrelevant change: the limit-point field feeds only `limitResult`, not
  // committedViewport or the Taylor approximation.
  await update(() => setNativeValue(limitPointInput, "5"));
  assert.equal(
    drawAxesSpy.mock.callCount(),
    afterMount,
    "an unrelated input change must not redraw the canvas",
  );

  // Relevant change: xMin feeds committedViewport directly.
  await update(() => setNativeValue(xMinInput, "-9"));
  assert.equal(
    drawAxesSpy.mock.callCount(),
    afterMount + 1,
    "a real viewport-bound change must redraw the canvas",
  );

  await unmount();
});
