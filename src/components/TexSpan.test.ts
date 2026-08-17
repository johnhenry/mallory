/**
 * Behavioral test for TexSpan's KaTeX-render memoization (issue #236):
 * `katex.renderToString` is real work (a full LaTeX parse + layout pass),
 * so it must run once per distinct `tex` value, not once per render.
 *
 * Same happy-dom + React 19 `act()` + `react-dom/client` harness as
 * use-cell.test.ts (see that file's own doc comment for the rationale) --
 * no @testing-library/react, no react-test-renderer.
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { Window } from "happy-dom";
import katex from "katex";

const domWindow = new Window();
(globalThis as Record<string, unknown>).window = domWindow;
(globalThis as Record<string, unknown>).document = domWindow.document;
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { createElement, act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { TexSpan } = await import("./TexSpan.tsx");

async function mount(element: ReturnType<typeof createElement>) {
  const container = domWindow.document.createElement("div");
  domWindow.document.body.appendChild(container as never);
  const root = createRoot(container as unknown as Element);
  await act(async () => {
    root.render(element);
  });
  return {
    update: (fn: () => void) => act(async () => fn()),
    unmount: () => act(async () => root.unmount()),
  };
}

test("TexSpan: an unrelated re-render does not re-invoke katex.renderToString, but a real tex change does", async () => {
  const renderSpy = mock.method(katex, "renderToString");
  let setTex: (v: string) => void = () => {};
  let bumpTick: (fn: (n: number) => number) => void = () => {};
  function Wrapper() {
    const [tex, tSet] = useState("x^2");
    const [, tickSet] = useState(0);
    setTex = tSet;
    bumpTick = tickSet;
    return createElement(TexSpan, { tex });
  }
  const { update, unmount } = await mount(createElement(Wrapper));
  const afterMount = renderSpy.mock.callCount();
  assert.equal(afterMount, 1, "expected exactly one katex render on mount");

  // Unrelated re-render: only `tick` state changes, `tex` prop stays "x^2".
  await update(() => bumpTick((n) => n + 1));
  assert.equal(
    renderSpy.mock.callCount(),
    afterMount,
    "an unrelated re-render must not re-invoke katex.renderToString",
  );

  // Relevant change: `tex` itself changes -- the memoized render must update.
  await update(() => setTex("y^2"));
  assert.equal(
    renderSpy.mock.callCount(),
    afterMount + 1,
    "a real tex change must re-invoke katex.renderToString",
  );

  await unmount();
});
