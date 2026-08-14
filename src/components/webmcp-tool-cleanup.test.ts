import assert from "node:assert/strict";
import { test } from "node:test";
import { setupTestDom } from "../lib/test-dom.ts";

const { createElement, mount, domWindow } = await setupTestDom();
const discretePanelModule = await import("./DiscretePanel.tsx");
// DiscretePanel's single, all-optional-with-default props parameter
// (`{ cellId = "discrete-1" }: { cellId?: string } = {}`) doesn't satisfy
// createElement's overload resolution the way ExpressionRow/AlgebraView's
// named, partly-required prop interfaces do -- a re-typed local alias
// sidesteps that inference gap rather than fighting it.
const DiscretePanel = discretePanelModule.DiscretePanel as (props: { cellId: string }) => ReturnType<typeof createElement>;

interface FakeRegisteredTool {
  name: string;
  signal: AbortSignal;
  aborted: boolean;
}

/** A fake `document.modelContext` (the real one comes from `@mcp-b/global`, dynamically imported only when agent mode is on -- see use-model-context-tool.ts's own doc comment) that just records registerTool calls and whether each one's abort signal later fires. */
function installFakeModelContext(): FakeRegisteredTool[] {
  const registered: FakeRegisteredTool[] = [];
  (domWindow.document as unknown as { modelContext: unknown }).modelContext = {
    registerTool(tool: { name: string }, options: { signal: AbortSignal }) {
      const entry: FakeRegisteredTool = { name: tool.name, signal: options.signal, aborted: false };
      options.signal.addEventListener("abort", () => {
        entry.aborted = true;
      });
      registered.push(entry);
    },
  };
  return registered;
}

test("mounting a panel registers its WebMCP tools, and unmounting aborts all of them", async () => {
  const registered = installFakeModelContext();

  const { unmount } = await mount(createElement(DiscretePanel, { cellId: "wmcp-test" }));

  const names = registered.map((r) => r.name).sort();
  assert.deepEqual(names, [
    "data_discrete_wmcp-test_get_cell",
    "data_discrete_wmcp-test_list_cells",
    "data_discrete_wmcp-test_set_cell",
  ]);
  assert.ok(
    registered.every((r) => !r.aborted),
    "no tool should be aborted while the panel is still mounted",
  );

  await unmount();

  assert.ok(
    registered.every((r) => r.aborted),
    `every registered tool's signal should abort on unmount, got: ${registered.map((r) => `${r.name}=${r.aborted}`).join(", ")}`,
  );
});
