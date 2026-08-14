/**
 * Shared happy-dom + React harness for component-level tests -- extracted
 * from use-cell.test.ts's original inline setup (see its own doc comment
 * for the full infrastructure rationale: happy-dom over jsdom/
 * react-test-renderer/@testing-library/react, React 19's stable `act()`,
 * `react-dom/client` directly).
 *
 * IMPORT-ORDER GOTCHA (same one use-cell.test.ts's original comment
 * documents): `react-dom/client` must see the DOM shim on `globalThis` at
 * import time. A plain top-level `import` is hoisted and evaluated before
 * this function's body would run the shim install, so React/ReactDOM are
 * pulled in via `await import(...)` here instead, AFTER the shim -- dynamic
 * `import()` executes at the call site, not hoisted, so this ordering is
 * safe even wrapped in a function (unlike a static import would be).
 *
 * Call `setupTestDom()` once per test file (Node's test runner isolates
 * each matched file into its own child process by default, so this
 * function's `globalThis` mutation doesn't leak across files) and use the
 * returned `mount`.
 */
export async function setupTestDom() {
  const { Window } = await import("happy-dom");
  const domWindow = new Window();
  (globalThis as Record<string, unknown>).window = domWindow;
  (globalThis as Record<string, unknown>).document = domWindow.document;
  // React's act() refuses to run (warns) unless this flag is set.
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

  const { createElement, act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { renderToString } = await import("react-dom/server");

  /** Mounts `element` into a fresh happy-dom container; returns the container plus `update`/`unmount` runners (both wrap act). */
  async function mount(element: ReturnType<typeof createElement>) {
    const container = domWindow.document.createElement("div");
    domWindow.document.body.appendChild(container as never);
    const root = createRoot(container as unknown as Element);
    await act(async () => {
      root.render(element);
    });
    return {
      container: container as unknown as HTMLElement,
      update: (fn: () => void) => act(async () => fn()),
      unmount: () => act(async () => root.unmount()),
    };
  }

  return { domWindow, createElement, act, createRoot, renderToString, mount };
}
