import assert from "node:assert/strict";
import { test } from "node:test";
import { setupTestDom } from "../lib/test-dom.ts";

const { createElement, mount, domWindow } = await setupTestDom();
const { useSymbolicTools } = await import("./use-symbolic-tools.ts");

interface FakeTool {
  name: string;
  execute: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }>;
}

/** Installs a fake document.modelContext and returns a name->tool lookup, populated once the probe mounts. */
function installFakeModelContext(): Map<string, FakeTool> {
  const tools = new Map<string, FakeTool>();
  (domWindow.document as unknown as { modelContext: unknown }).modelContext = {
    registerTool(tool: FakeTool) {
      tools.set(tool.name, tool);
    },
  };
  return tools;
}

async function callTool(tools: Map<string, FakeTool>, name: string, args: Record<string, unknown>) {
  const tool = tools.get(name);
  assert.ok(tool, `expected a registered tool named "${name}"`);
  const result = await tool!.execute(args);
  return result;
}

function Probe() {
  useSymbolicTools();
  return null;
}

test("useSymbolicTools: registers all 6 general CAS tools", async () => {
  const tools = installFakeModelContext();
  const { unmount } = await mount(createElement(Probe));
  assert.deepEqual(
    [...tools.keys()].sort(),
    ["symbolic_differentiate", "symbolic_evaluate", "symbolic_integrate", "symbolic_parse", "symbolic_simplify", "symbolic_solve"],
  );
  await unmount();
});

test("symbolic_parse: normalizes an expression", async () => {
  const tools = installFakeModelContext();
  const { unmount } = await mount(createElement(Probe));
  const result = await callTool(tools, "symbolic_parse", { expr: "x^2+2*x+1" });
  assert.equal(JSON.parse(result.content[0]!.text), "x^2 + 2*x + 1");
  await unmount();
});

test("symbolic_simplify: simplifies x+0 to x", async () => {
  const tools = installFakeModelContext();
  const { unmount } = await mount(createElement(Probe));
  const result = await callTool(tools, "symbolic_simplify", { expr: "x+0" });
  assert.equal(JSON.parse(result.content[0]!.text), "x");
  await unmount();
});

test("symbolic_differentiate: default variable is x", async () => {
  const tools = installFakeModelContext();
  const { unmount } = await mount(createElement(Probe));
  const result = await callTool(tools, "symbolic_differentiate", { expr: "x^3" });
  assert.equal(JSON.parse(result.content[0]!.text), "3*x^2");
  await unmount();
});

test("symbolic_differentiate: respects an explicit variable", async () => {
  const tools = installFakeModelContext();
  const { unmount } = await mount(createElement(Probe));
  const result = await callTool(tools, "symbolic_differentiate", { expr: "x*y^2", variable: "y" });
  assert.equal(JSON.parse(result.content[0]!.text), "2*(x*y)");
  await unmount();
});

test("symbolic_integrate: finds the antiderivative of cos(x)", async () => {
  const tools = installFakeModelContext();
  const { unmount } = await mount(createElement(Probe));
  const result = await callTool(tools, "symbolic_integrate", { expr: "cos(x)" });
  assert.equal(JSON.parse(result.content[0]!.text), "sin(x)");
  await unmount();
});

test("symbolic_integrate: a non-elementarily-integrable expression reports isError, not a crash", async () => {
  const tools = installFakeModelContext();
  const { unmount } = await mount(createElement(Probe));
  const result = await callTool(tools, "symbolic_integrate", { expr: "sin(x^2)" });
  assert.equal(result.isError, true);
  await unmount();
});

test("symbolic_solve: finds both roots of x^2-4", async () => {
  const tools = installFakeModelContext();
  const { unmount } = await mount(createElement(Probe));
  const result = await callTool(tools, "symbolic_solve", { expr: "x^2-4" });
  assert.deepEqual(JSON.parse(result.content[0]!.text).sort(), ["-2", "2"]);
  await unmount();
});

test("symbolic_evaluate: substitutes env values", async () => {
  const tools = installFakeModelContext();
  const { unmount } = await mount(createElement(Probe));
  const result = await callTool(tools, "symbolic_evaluate", { expr: "x^2+1", env: { x: 3 } });
  assert.equal(JSON.parse(result.content[0]!.text), 10);
  await unmount();
});
