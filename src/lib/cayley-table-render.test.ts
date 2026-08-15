import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGroupInfo } from "./discrete-math.ts";
import { cayleyTableCanvasSize, drawCayleyTable } from "./cayley-table-render.ts";

/** Records every call instead of actually rendering -- Node's test runner has no real Canvas2D implementation, so this is the standard "fake the drawing surface, assert on the call log" pattern for canvas-drawing code, matching how `render-path.ts`'s own draw functions are exercised at the call-site level elsewhere in this codebase. */
class FakeCtx {
  calls: string[] = [];
  fillStyle = "";
  strokeStyle = "";
  font = "";
  textAlign = "";
  textBaseline = "";
  clearRect(x: number, y: number, w: number, h: number) {
    this.calls.push(`clearRect(${x},${y},${w},${h})`);
  }
  fillRect(x: number, y: number, w: number, h: number) {
    this.calls.push(`fillRect(${x},${y},${w},${h}) fillStyle=${this.fillStyle}`);
  }
  strokeRect(x: number, y: number, w: number, h: number) {
    this.calls.push(`strokeRect(${x},${y},${w},${h})`);
  }
  fillText(text: string, x: number, y: number) {
    this.calls.push(`fillText("${text}",${x},${y})`);
  }
}

test("cayleyTableCanvasSize: (labels.length + 1) cells per side at the given cellSize", () => {
  // buildGroupInfo("cyclic", 2) -- oracle-verified elsewhere (discrete-math.test.ts) to have exactly 2 labels.
  const info = buildGroupInfo("cyclic", 2);
  assert.deepEqual(cayleyTableCanvasSize(info, 32), { width: 96, height: 96 });
  assert.deepEqual(cayleyTableCanvasSize(info, 10), { width: 30, height: 30 });
});

test("drawCayleyTable: Z2's table (labels 0,1; identity=0) renders the exact header and body labels at hand-computed cell positions", () => {
  const info = buildGroupInfo("cyclic", 2);
  const ctx = new FakeCtx();
  drawCayleyTable(ctx as unknown as CanvasRenderingContext2D, info, 10);

  // Header row (row 0): column labels "0" at col 1 (x=10..20, center x=15), "1" at col 2 (x=20..30, center x=25) -- row 0 center y=5.
  assert.ok(ctx.calls.includes('fillText("0",15,5)'), "expected column header \"0\" centered in cell (1,0)");
  assert.ok(ctx.calls.includes('fillText("1",25,5)'), "expected column header \"1\" centered in cell (2,0)");
  // Header column (col 0): row labels "0" at row 1 (y=10..20, center y=15), "1" at row 2 (y=20..30, center y=25) -- col 0 center x=5.
  assert.ok(ctx.calls.includes('fillText("0",5,15)'), "expected row header \"0\" centered in cell (0,1)");
  assert.ok(ctx.calls.includes('fillText("1",5,25)'), "expected row header \"1\" centered in cell (0,2)");
  // Body: table[0][0]=0 -> "0" at (1,1) center (15,15); table[0][1]=1 -> "1" at (2,1) center (25,15);
  // table[1][0]=1 -> "1" at (1,2) center (15,25); table[1][1]=0 -> "0" at (2,2) center (25,25).
  assert.ok(ctx.calls.includes('fillText("0",15,15)'));
  assert.ok(ctx.calls.includes('fillText("1",25,15)'));
  assert.ok(ctx.calls.includes('fillText("1",15,25)'));
  assert.ok(ctx.calls.includes('fillText("0",25,25)'));
});

test("drawCayleyTable: highlights exactly the identity element's cells (table[i][j] === identityIndex), not every cell", () => {
  const info = buildGroupInfo("cyclic", 2);
  const ctx = new FakeCtx();
  drawCayleyTable(ctx as unknown as CanvasRenderingContext2D, info, 10);

  // Identity is index 0. table = [[0,1],[1,0]] -- identity cells are (row=1,col=1) and (row=2,col=2).
  // Excludes the one whole-canvas background fillRect (theme surface color, not the highlight color).
  const highlightCalls = ctx.calls.filter((c) => c.startsWith("fillRect") && c.includes("fillStyle=#dcfce7"));
  // Body is 2x2, so exactly 2 of the 4 body cells should get a highlight fillRect (the other 2 are off-diagonal, value 1).
  assert.equal(highlightCalls.length, 2);
});
