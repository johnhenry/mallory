import assert from "node:assert/strict";
import { test } from "node:test";
import { computeNiceTicks, drawAxes, hexToRgba } from "./render-path.ts";

/** Same fake-canvas pattern as cayley-table-render.test.ts: record calls instead of rendering, since Node's test runner has no real Canvas2D. */
class FakeCtx {
  calls: string[] = [];
  strokeStyle = "";
  fillStyle = "";
  font = "";
  lineWidth = 0;
  textAlign = "";
  textBaseline = "";
  save() {}
  restore() {}
  beginPath() {}
  moveTo(x: number, y: number) {
    this.calls.push(`moveTo(${x},${y})`);
  }
  lineTo(x: number, y: number) {
    this.calls.push(`lineTo(${x},${y})`);
  }
  stroke() {
    this.calls.push("stroke");
  }
  fillText(text: string, x: number, y: number) {
    this.calls.push(`fillText("${text}",${x},${y},align=${this.textAlign},baseline=${this.textBaseline})`);
  }
}

test("hexToRgba: decomposes a 0xRRGGBB color into its channels, hand-computed", () => {
  assert.equal(hexToRgba(0x2563eb, 0.25), "rgba(37, 99, 235, 0.25)");
  assert.equal(hexToRgba(0xdc2626, 0.5), "rgba(220, 38, 38, 0.5)");
});

test("hexToRgba: black and white edge cases", () => {
  assert.equal(hexToRgba(0x000000, 1), "rgba(0, 0, 0, 1)");
  assert.equal(hexToRgba(0xffffff, 0), "rgba(255, 255, 255, 0)");
});

test("computeNiceTicks: [0,10] at target 5 picks a clean step of 2, hand-computed", () => {
  assert.deepEqual(computeNiceTicks(0, 10, 5), [0, 2, 4, 6, 8, 10]);
});

test("computeNiceTicks: scales the same way at a larger magnitude ([0,100] -> step 20)", () => {
  assert.deepEqual(computeNiceTicks(0, 100, 5), [0, 20, 40, 60, 80, 100]);
});

test("computeNiceTicks: negative range straddling zero", () => {
  assert.deepEqual(computeNiceTicks(-5, 5, 5), [-4, -2, 0, 2, 4]);
});

test("computeNiceTicks: sub-1 range picks a decimal step, no float noise in the labels", () => {
  assert.deepEqual(computeNiceTicks(0, 1, 5), [0, 0.2, 0.4, 0.6, 0.8, 1]);
});

test("computeNiceTicks: very small range keeps large integers exact via toFixed rounding, not raw float multiplication", () => {
  assert.deepEqual(computeNiceTicks(0, 0.01, 5), [0, 0.002, 0.004, 0.006, 0.008, 0.01]);
});

test("computeNiceTicks: degenerate range (min === max, or min > max) returns no ticks rather than looping forever", () => {
  assert.deepEqual(computeNiceTicks(5, 5, 5), []);
  assert.deepEqual(computeNiceTicks(5, 3, 5), []);
});

test("drawAxes: origin-centered viewport draws both axis lines through the true zero and skips the x-axis's redundant \"0\" label", () => {
  const ctx = new FakeCtx();
  drawAxes(ctx as unknown as CanvasRenderingContext2D, { xMin: -5, xMax: 5, yMin: -5, yMax: 5 }, 100, 100, {
    targetTickCount: 5,
  });
  assert.deepEqual(ctx.calls, [
    "moveTo(0,50)",
    "lineTo(100,50)",
    "moveTo(50,0)",
    "lineTo(50,100)",
    "stroke",
    "moveTo(10,46)",
    "lineTo(10,54)",
    "stroke",
    'fillText("-4",10,56,align=center,baseline=top)',
    "moveTo(30,46)",
    "lineTo(30,54)",
    "stroke",
    'fillText("-2",30,56,align=center,baseline=top)',
    "moveTo(50,46)",
    "lineTo(50,54)",
    "stroke",
    "moveTo(70,46)",
    "lineTo(70,54)",
    "stroke",
    'fillText("2",70,56,align=center,baseline=top)',
    "moveTo(90,46)",
    "lineTo(90,54)",
    "stroke",
    'fillText("4",90,56,align=center,baseline=top)',
    "moveTo(46,90)",
    "lineTo(54,90)",
    "stroke",
    'fillText("-4",42,90,align=right,baseline=middle)',
    "moveTo(46,70)",
    "lineTo(54,70)",
    "stroke",
    'fillText("-2",42,70,align=right,baseline=middle)',
    "moveTo(46,50)",
    "lineTo(54,50)",
    "stroke",
    'fillText("0",42,50,align=right,baseline=middle)',
    "moveTo(46,30)",
    "lineTo(54,30)",
    "stroke",
    'fillText("2",42,30,align=right,baseline=middle)',
    "moveTo(46,10)",
    "lineTo(54,10)",
    "stroke",
    'fillText("4",42,10,align=right,baseline=middle)',
  ]);
  // The x-axis's own "0" tick mark is drawn but never gets a fillText -- only the y-axis's "0" (checked above) carries the label.
  assert.equal(ctx.calls.filter((c) => c.startsWith('fillText("0"')).length, 1);
});

test("drawAxes: a viewport panned entirely above y=0 hugs the x-axis to the bottom edge and flips its labels above the tick (avoiding off-canvas clipping)", () => {
  const ctx = new FakeCtx();
  drawAxes(ctx as unknown as CanvasRenderingContext2D, { xMin: 0, xMax: 10, yMin: 2, yMax: 12 }, 100, 100, {
    targetTickCount: 5,
  });
  // Axis lines: x-axis clamped to the bottom edge (sy=100, since data-value 0 is below the whole [2,12] range); y-axis at its true position (x=0 is the viewport's own left edge here).
  assert.deepEqual(ctx.calls.slice(0, 5), ["moveTo(0,100)", "lineTo(100,100)", "moveTo(0,0)", "lineTo(0,100)", "stroke"]);
  // x tick labels flip to baseline="bottom" (drawn above the tick) since the axis line itself sits on the bottom edge.
  assert.ok(ctx.calls.includes('fillText("2",20,94,align=center,baseline=bottom)'));
  assert.ok(ctx.calls.includes('fillText("10",100,94,align=center,baseline=bottom)'));
  // x-axis's own "0" tick mark still draws (at screen x=0) but carries no label (0 is outside [xMin,xMax]=[0,10]... actually 0 IS xMin here, so it's the leftmost tick -- but with no coinciding y=0 label to protect against since the y-axis's own zero tick is off-viewport).
  // y ticks: computeNiceTicks(2,12,5) = [2,4,6,8,10,12], all labeled (y-axis is at its true, non-clamped position x=0, not hugging the left edge in the "flip" sense since xMin===0 exactly).
  assert.ok(ctx.calls.includes('fillText("12",-8,0,align=right,baseline=middle)'));
});

test("drawAxes: a degenerate/inverted viewport (xMax <= xMin) draws nothing rather than emitting NaN screen coordinates", () => {
  const ctx = new FakeCtx();
  drawAxes(ctx as unknown as CanvasRenderingContext2D, { xMin: 5, xMax: 5, yMin: -1, yMax: 1 }, 100, 100);
  assert.deepEqual(ctx.calls, []);
});
