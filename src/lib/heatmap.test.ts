import assert from "node:assert/strict";
import { test } from "node:test";
import { drawHeatmap, finiteRange, heatCellColor } from "./heatmap.ts";

test("heatCellColor: the minimum finite value is white", () => {
  assert.equal(heatCellColor(0, 0, 10), "rgb(255, 255, 255)");
});

test("heatCellColor: the maximum finite value is the deep-blue endpoint", () => {
  assert.equal(heatCellColor(10, 0, 10), "rgb(29, 78, 216)");
});

test("heatCellColor: a midpoint value linearly interpolates (hand-computed: t=0.5 -> [142, 167, 236])", () => {
  assert.equal(heatCellColor(5, 0, 10), "rgb(142, 167, 236)");
});

test("heatCellColor: a non-finite (absent) value is a flat neutral gray, distinct from the white 'min' color", () => {
  assert.equal(heatCellColor(Infinity, 0, 10), "rgb(243, 244, 246)");
  assert.equal(heatCellColor(-Infinity, 0, 10), "rgb(243, 244, 246)");
  assert.equal(heatCellColor(Number.NaN, 0, 10), "rgb(243, 244, 246)");
});

test("heatCellColor: a uniform range (max <= min) returns a flat color rather than dividing by zero", () => {
  assert.equal(heatCellColor(3, 3, 3), "rgb(191, 219, 254)");
  assert.doesNotThrow(() => heatCellColor(3, 5, 2));
});

test("finiteRange: ignores Infinity cells when computing min/max", () => {
  const range = finiteRange([
    [0, 3, Infinity],
    [3, 0, 5],
    [Infinity, 5, 0],
  ]);
  assert.deepEqual(range, { min: 0, max: 5 });
});

test("finiteRange: an all-non-finite matrix returns {min:0, max:0} rather than {min:Infinity, max:-Infinity}", () => {
  assert.deepEqual(
    finiteRange([
      [Infinity, Infinity],
      [Infinity, Infinity],
    ]),
    { min: 0, max: 0 },
  );
});

test("finiteRange: an empty matrix returns {min:0, max:0}", () => {
  assert.deepEqual(finiteRange([]), { min: 0, max: 0 });
});

function makeFakeCtx() {
  const fillRectCalls: Array<{ fillStyle: string; x: number; y: number; w: number; h: number }> = [];
  const fillTextCalls: Array<{ text: string; x: number; y: number }> = [];
  let currentFillStyle = "";
  let translateX = 0;
  let translateY = 0;
  const ctx = {
    save: () => {},
    restore: () => {},
    translate: (x: number, y: number) => {
      translateX = x;
      translateY = y;
    },
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    set fillStyle(v: string) {
      currentFillStyle = v;
    },
    get fillStyle() {
      return currentFillStyle;
    },
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    fillRect: (x: number, y: number, w: number, h: number) => {
      fillRectCalls.push({ fillStyle: currentFillStyle, x: x + translateX, y: y + translateY, w, h });
    },
    fillText: (text: string, x: number, y: number) => {
      fillTextCalls.push({ text, x: x + translateX, y: y + translateY });
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, getFillRectCalls: () => fillRectCalls, getFillTextCalls: () => fillTextCalls };
}

test("drawHeatmap: fills one rect per matrix cell, colored by heatCellColor", () => {
  const { ctx, getFillRectCalls } = makeFakeCtx();
  const matrix = [
    [0, 3],
    [3, 0],
  ];
  drawHeatmap(ctx, matrix, ["A", "B"], 100, 100, 0);
  const calls = getFillRectCalls();
  assert.equal(calls.length, 4);
  // (0,0) and (1,1) are the matrix's own min (0); (0,1) and (1,0) are its max (3).
  assert.equal(calls[0]?.fillStyle, heatCellColor(0, 0, 3));
  assert.equal(calls[1]?.fillStyle, heatCellColor(3, 0, 3));
});

test("drawHeatmap: an empty matrix draws nothing (no crash)", () => {
  const { ctx, getFillRectCalls } = makeFakeCtx();
  drawHeatmap(ctx, [], [], 100, 100, 0);
  assert.equal(getFillRectCalls().length, 0);
});

test("drawHeatmap: draws a value label only for finite cells, not for Infinity (no-edge) ones", () => {
  const { ctx, getFillTextCalls } = makeFakeCtx();
  const matrix = [
    [0, Infinity],
    [Infinity, 0],
  ];
  drawHeatmap(ctx, matrix, ["A", "B"], 100, 100, 0);
  const cellLabels = getFillTextCalls().map((c) => c.text);
  // Two finite-cell value labels (both "0"), no label for the two Infinity cells.
  assert.equal(cellLabels.filter((t) => t === "0").length, 2);
});
