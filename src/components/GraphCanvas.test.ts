import assert from "node:assert/strict";
import { test } from "node:test";
import type { Path2D } from "@johnhenry/math";
import { drawGraphCanvas } from "./GraphCanvas.tsx";

/** Same fake-canvas pattern as render-path.test.ts/cayley-table-render.test.ts: record calls instead of rendering, since Node's test runner has no real Canvas2D. */
class FakeCtx {
  calls: string[] = [];
  strokeStyle = "";
  fillStyle = "";
  font = "";
  lineWidth = 0;
  globalAlpha = 1;
  textAlign = "";
  textBaseline = "";
  save() {}
  restore() {}
  beginPath() {}
  closePath() {}
  fill() {
    this.calls.push("fill");
  }
  setLineDash(_segments: number[]) {}
  moveTo(x: number, y: number) {
    this.calls.push(`moveTo(${x},${y})`);
  }
  lineTo(x: number, y: number) {
    this.calls.push(`lineTo(${x},${y})`);
  }
  stroke() {
    this.calls.push("stroke");
  }
  arc(x: number, y: number, r: number) {
    this.calls.push(`arc(${x},${y},${r})`);
  }
  fillRect(x: number, y: number, w: number, h: number) {
    this.calls.push(`fillRect(${x},${y},${w},${h})`);
  }
  strokeRect(x: number, y: number, w: number, h: number) {
    this.calls.push(`strokeRect(${x},${y},${w},${h})`);
  }
  fillText(text: string, x: number, y: number) {
    this.calls.push(`fillText("${text}",${x},${y})`);
  }
  clearRect(x: number, y: number, w: number, h: number) {
    this.calls.push(`clearRect(${x},${y},${w},${h})`);
  }
}

function fakePath(): Path2D {
  return {
    stroke: { thickness: 2, color: 0x2563eb, alpha: 1, pixelHinting: false, scaleMode: "normal", caps: null, joints: null, miterLimit: 3 },
    commands: [
      { op: "moveTo", x: 0, y: 0 },
      { op: "lineTo", x: 1, y: 1 },
    ],
  } as unknown as Path2D;
}

test("drawGraphCanvas: clears the canvas at the given width/height, not a hardcoded size", () => {
  const ctx = new FakeCtx();
  drawGraphCanvas(ctx as unknown as CanvasRenderingContext2D, 1200, 1200, {
    viewport: { xMin: -1, xMax: 1, yMin: -1, yMax: 1 },
    scatter: null,
    regionMask: null,
    showArea: false,
    area: null,
    path: fakePath(),
    showExtrema: false,
    extrema: null,
    point: null,
  });
  assert.ok(ctx.calls.includes("clearRect(0,0,1200,1200)"), `expected a clearRect(0,0,1200,1200) call, got: ${ctx.calls.join(", ")}`);
});

test("drawGraphCanvas: doubling width/height doubles the plotted curve's screen-space coordinates, proving the 2x re-render is a genuine higher-resolution redraw, not an upscale", () => {
  const params = {
    viewport: { xMin: -1, xMax: 1, yMin: -1, yMax: 1 },
    scatter: null,
    regionMask: null,
    showArea: false,
    area: null,
    path: fakePath(),
    showExtrema: false,
    extrema: null,
    point: null,
  };

  const ctx1x = new FakeCtx();
  drawGraphCanvas(ctx1x as unknown as CanvasRenderingContext2D, 600, 600, params);
  const ctx2x = new FakeCtx();
  drawGraphCanvas(ctx2x as unknown as CanvasRenderingContext2D, 1200, 1200, params);

  // The path's (0,0) data point maps to the viewport center: (300,300) at
  // 1x, (600,600) at 2x -- exactly double, hand-computed from the viewport.
  assert.ok(ctx1x.calls.includes("moveTo(300,300)"), `1x calls: ${ctx1x.calls.join(", ")}`);
  assert.ok(ctx2x.calls.includes("moveTo(600,600)"), `2x calls: ${ctx2x.calls.join(", ")}`);
});

test("drawGraphCanvas: scatter mode draws the scatter layer instead of the path/area/extrema layers", () => {
  const ctx = new FakeCtx();
  drawGraphCanvas(ctx as unknown as CanvasRenderingContext2D, 100, 100, {
    viewport: { xMin: -1, xMax: 1, yMin: -1, yMax: 1 },
    scatter: [{ x: 0, y: 0 }],
    regionMask: null,
    showArea: false,
    area: null,
    path: fakePath(),
    showExtrema: false,
    extrema: null,
    point: null,
  });
  // The scatter point (0,0) draws as an arc at the viewport center (50,50);
  // the path's own moveTo(0,0)->(50,50) must NOT also appear (scatter mode
  // is exclusive of the path/area/extrema branch).
  assert.ok(ctx.calls.some((c) => c.startsWith("arc(50,50,")), `expected a scatter arc at (50,50), got: ${ctx.calls.join(", ")}`);
  assert.ok(!ctx.calls.includes("moveTo(50,50)"), `path should not be drawn in scatter mode, got: ${ctx.calls.join(", ")}`);
});
