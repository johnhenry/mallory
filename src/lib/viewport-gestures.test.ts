import assert from "node:assert/strict";
import { test } from "node:test";
import { toDataX, toDataY } from "./viewport.ts";
import { pinchZoomFactor, viewportFromAnchor, wheelZoomFactor } from "./viewport-gestures.ts";

test("viewportFromAnchor: hand-computed viewport for a given anchor/screen-point/span/canvas-size", () => {
  const result = viewportFromAnchor(5, 10, 100, 50, 20, 10, 200, 100);
  assert.deepEqual(result, { xMin: -5, xMax: 15, yMin: 5, yMax: 15 });
});

test("viewportFromAnchor: the anchor data point round-trips back to the same screen point via toDataX/toDataY (the whole point of the formula)", () => {
  const anchorX = 5;
  const anchorY = 10;
  const sx = 100;
  const sy = 50;
  const width = 200;
  const height = 100;
  const viewport = viewportFromAnchor(anchorX, anchorY, sx, sy, 20, 10, width, height);
  assert.equal(toDataX(sx, viewport, width), anchorX);
  assert.equal(toDataY(sy, viewport, height), anchorY);
});

test("viewportFromAnchor: anchoring at the top-left corner (sx=0, sy=0) makes the anchor the viewport's own xMin/yMax", () => {
  const result = viewportFromAnchor(3, 7, 0, 0, 10, 4, 200, 100);
  assert.equal(result.xMin, 3);
  assert.equal(result.yMax, 7);
});

test("wheelZoomFactor: positive deltaY (scroll down/away) zooms out with the given step, hand-computed", () => {
  assert.equal(wheelZoomFactor(10, 1.1), 1.1);
});

test("wheelZoomFactor: non-positive deltaY zooms in as the reciprocal of the step, hand-computed", () => {
  assert.equal(wheelZoomFactor(-5, 1.1), 1 / 1.1);
  assert.equal(wheelZoomFactor(0, 1.1), 1 / 1.1); // deltaY===0 treated as "not scrolling out" -> zoom in, matching GraphCanvasMulti's own `> 0` check
});

test("wheelZoomFactor: defaults to a 1.1 step when none is given", () => {
  assert.equal(wheelZoomFactor(10), 1.1);
  assert.equal(wheelZoomFactor(-10), 1 / 1.1);
});

test("pinchZoomFactor: fingers moving apart (current > start) produces a factor below 1 (zoom in), hand-computed", () => {
  assert.equal(pinchZoomFactor(100, 200), 0.5);
});

test("pinchZoomFactor: fingers moving together (current < start) produces a factor above 1 (zoom out), hand-computed", () => {
  assert.equal(pinchZoomFactor(100, 50), 2);
});

test("pinchZoomFactor: unchanged distance produces a factor of exactly 1 (no zoom)", () => {
  assert.equal(pinchZoomFactor(80, 80), 1);
});
