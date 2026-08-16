import assert from "node:assert/strict";
import { test } from "node:test";
import {
  axesToSvgElements,
  pathToSvgD,
  pathsToSvgDocument,
  polylinePointsToSvgD,
  polylineToSvgDocument,
  polylinesToSvgDocument,
  scatterPointsToSvgDocument,
  svgExportFilename,
} from "./svg-export.ts";

// getThemeColors() falls back to the light-theme palette outside a DOM (node:test has no `document`) --
// same fallback constants theme-colors.ts's own FALLBACK uses.
const MUTED = "#64748b";
const INK = "#1c2531";

test("svgExportFilename: slugifies like pngExportFilename but with a .svg extension", () => {
  assert.equal(svgExportFilename("graphing"), "mallory-graph-graphing.svg");
  assert.equal(svgExportFilename("Complex Plane!"), "mallory-graph-complex-plane.svg");
  assert.equal(svgExportFilename(""), "mallory-graph-export.svg");
});

const VIEWPORT = { xMin: 0, xMax: 2, yMin: 0, yMax: 2 };

test("pathToSvgD: converts moveTo/lineTo commands to M/L using the same viewport transform as drawPath", () => {
  const path = {
    stroke: { thickness: 1, color: 0, alpha: 1, pixelHinting: false, scaleMode: "normal", caps: null, joints: null, miterLimit: 3 },
    commands: [
      { op: "moveTo" as const, x: 0, y: 0 },
      { op: "lineTo" as const, x: 1, y: 1 },
    ],
  };
  // toScreenX(0)=0, toScreenY(0)=100 (screen y flips); toScreenX(1)=50, toScreenY(1)=50.
  assert.equal(pathToSvgD(path, VIEWPORT, 100, 100), "M0.00 100.00 L50.00 50.00");
});

test("pathsToSvgDocument: wraps a path into an SVG document with the hand-computed stroke color/opacity/width", () => {
  const path = {
    stroke: { thickness: 2, color: 0x2563eb, alpha: 1, pixelHinting: false, scaleMode: "normal", caps: null, joints: null, miterLimit: 3 },
    commands: [{ op: "moveTo" as const, x: 0, y: 0 }],
  };
  const svg = pathsToSvgDocument([path], VIEWPORT, 100, 100);
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">'));
  assert.ok(svg.includes('stroke="#2563eb"'));
  assert.ok(svg.includes('stroke-opacity="1"'));
  assert.ok(svg.includes('stroke-width="2"'));
  assert.ok(svg.includes('fill="none"'));
  assert.ok(svg.trim().endsWith("</svg>"));
});

test("pathsToSvgDocument: an empty paths array still produces a valid (empty) SVG document", () => {
  const svg = pathsToSvgDocument([], VIEWPORT, 50, 50, false);
  assert.equal(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 50 50">\n\n</svg>');
});

test("pathsToSvgDocument: axes default on, prepended before the curve so the curve renders on top", () => {
  const path = {
    stroke: { thickness: 1, color: 0, alpha: 1, pixelHinting: false, scaleMode: "normal", caps: null, joints: null, miterLimit: 3 },
    commands: [{ op: "moveTo" as const, x: 0, y: 0 }],
  };
  const svg = pathsToSvgDocument([path], VIEWPORT, 50, 50);
  assert.ok(svg.includes("<line"), "expected axis lines by default");
  assert.ok(svg.indexOf("<line") < svg.indexOf("<path"), "axes must render before (under) the curve");
});

test("polylinePointsToSvgD: converts a plain point array to M/L using the same viewport transform as drawPolyline", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    { x: 2, y: 0 },
  ];
  // toScreenX(0)=0,toScreenY(0)=100; toScreenX(1)=50,toScreenY(1)=50; toScreenX(2)=100,toScreenY(0)=100.
  assert.equal(polylinePointsToSvgD(points, VIEWPORT, 100, 100), "M0.00 100.00 L50.00 50.00 L100.00 100.00");
});

test("polylinePointsToSvgD: an empty point array produces an empty d string", () => {
  assert.equal(polylinePointsToSvgD([], VIEWPORT, 100, 100), "");
});

test("polylineToSvgDocument: wraps points into an SVG document with the given color/stroke-width, defaulting drawPolyline's own blue/1.5px", () => {
  const points = [{ x: 0, y: 0 }];
  const defaultSvg = polylineToSvgDocument(points, VIEWPORT, 100, 100);
  assert.ok(defaultSvg.includes('stroke="#2563eb"'));
  assert.ok(defaultSvg.includes('stroke-width="1.5"'));
  assert.ok(defaultSvg.includes('fill="none"'));

  const customSvg = polylineToSvgDocument(points, VIEWPORT, 100, 100, "#dc2626", 3);
  assert.ok(customSvg.includes('stroke="#dc2626"'));
  assert.ok(customSvg.includes('stroke-width="3"'));
});

test("polylineToSvgDocument: an empty point array produces a valid (empty) SVG document, not a stray <path>", () => {
  const svg = polylineToSvgDocument([], VIEWPORT, 50, 50, "#2563eb", 1.5, false);
  assert.equal(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 50 50">\n\n</svg>');
});

test("polylineToSvgDocument: axes=false omits axis elements entirely", () => {
  const svg = polylineToSvgDocument([{ x: 0, y: 0 }], VIEWPORT, 50, 50, "#2563eb", 1.5, false);
  assert.ok(!svg.includes("<line"));
});

test("polylinesToSvgDocument: one <path> per line, hand-computed screen coordinates matching polylinePointsToSvgD for each line independently", () => {
  const lineA = [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ];
  const lineB = [
    { x: 2, y: 0 },
    { x: 2, y: 2 },
  ];
  const svg = polylinesToSvgDocument([lineA, lineB], VIEWPORT, 100, 100);
  assert.ok(svg.includes(`<path d="${polylinePointsToSvgD(lineA, VIEWPORT, 100, 100)}" fill="none" stroke="#2563eb" stroke-width="1.5" />`));
  assert.ok(svg.includes(`<path d="${polylinePointsToSvgD(lineB, VIEWPORT, 100, 100)}" fill="none" stroke="#2563eb" stroke-width="1.5" />`));
});

test("polylinesToSvgDocument: skips empty lines rather than emitting a stray zero-length <path>", () => {
  const svg = polylinesToSvgDocument([[], [{ x: 0, y: 0 }]], VIEWPORT, 100, 100);
  assert.equal((svg.match(/<path/g) ?? []).length, 1);
});

test("polylinesToSvgDocument: custom color/stroke-width applies to every line", () => {
  const svg = polylinesToSvgDocument(
    [
      [{ x: 0, y: 0 }],
      [{ x: 1, y: 1 }],
    ],
    VIEWPORT,
    100,
    100,
    "#dc2626",
    3,
  );
  assert.equal((svg.match(/stroke="#dc2626"/g) ?? []).length, 2);
  assert.equal((svg.match(/stroke-width="3"/g) ?? []).length, 2);
});

test("polylinesToSvgDocument: an empty lines array produces a valid (empty) SVG document", () => {
  const svg = polylinesToSvgDocument([], VIEWPORT, 50, 50, "#2563eb", 1.5, false);
  assert.equal(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 50 50">\n\n</svg>');
});

test("scatterPointsToSvgDocument: one <circle> per point, hand-computed screen coordinates using the same viewport transform drawScatter uses", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 2, y: 2 },
  ];
  // toScreenX(0)=0,toScreenY(0)=100; toScreenX(2)=100,toScreenY(2)=0.
  const svg = scatterPointsToSvgDocument(points, VIEWPORT, 100, 100);
  assert.ok(svg.includes('<circle cx="0.00" cy="100.00" r="5" fill="#2563eb" />'));
  assert.ok(svg.includes('<circle cx="100.00" cy="0.00" r="5" fill="#2563eb" />'));
});

test("scatterPointsToSvgDocument: custom color/radius override drawScatter's own defaults", () => {
  const svg = scatterPointsToSvgDocument([{ x: 0, y: 0 }], VIEWPORT, 100, 100, "#dc2626", 8);
  assert.ok(svg.includes('r="8" fill="#dc2626"'));
});

test("scatterPointsToSvgDocument: an empty point array still produces a valid (empty) SVG document", () => {
  const svg = scatterPointsToSvgDocument([], VIEWPORT, 50, 50, "#2563eb", 5, false);
  assert.equal(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 50 50">\n\n</svg>');
});

test("scatterPointsToSvgDocument: axes default on, prepended before the <circle> markers", () => {
  const svg = scatterPointsToSvgDocument([{ x: 0, y: 0 }], VIEWPORT, 50, 50);
  assert.ok(svg.includes("<line"));
  assert.ok(svg.indexOf("<line") < svg.indexOf("<circle"));
});

test("axesToSvgElements: centered viewport [0,2]x[0,2] on a 100x100 canvas, hand-computed axis lines/ticks/labels", () => {
  // Axis lines: x-axis at data-y=0 -> screen y=100 (toScreenY flips); y-axis at data-x=0 -> screen x=0.
  // computeNiceTicks(0, 2, 6) = [0, 0.5, 1, 1.5, 2] (step=0.5, D3-nice-number rule) for both axes.
  // Whole viewport straddles zero on both axes, so no edge-hugging; x-labels sit below (hanging),
  // y-labels sit left (text-anchor=end), and the origin's "0" is drawn once, only on the y-axis.
  const svg = axesToSvgElements({ xMin: 0, xMax: 2, yMin: 0, yMax: 2 }, 100, 100);
  assert.ok(svg.includes(`<line x1="0" y1="100" x2="100" y2="100" stroke="${MUTED}" stroke-width="1" />`), "x-axis line");
  assert.ok(svg.includes(`<line x1="0" y1="0" x2="0" y2="100" stroke="${MUTED}" stroke-width="1" />`), "y-axis line");
  assert.ok(svg.includes(`<line x1="25.00" y1="96.00" x2="25.00" y2="104.00" stroke="${MUTED}" stroke-width="1" />`), "x=0.5 tick");
  assert.ok(
    svg.includes(`<text x="25.00" y="106.00" fill="${INK}" font-size="11" font-family="system-ui, sans-serif" text-anchor="middle" dominant-baseline="hanging">0.5</text>`),
    "x=0.5 label below the axis",
  );
  assert.ok(svg.includes(`<line x1="-4.00" y1="75.00" x2="4.00" y2="75.00" stroke="${MUTED}" stroke-width="1" />`), "y=0.5 tick");
  assert.ok(
    svg.includes(`<text x="-8.00" y="75.00" fill="${INK}" font-size="11" font-family="system-ui, sans-serif" text-anchor="end" dominant-baseline="middle">0.5</text>`),
    "y=0.5 label left of the axis",
  );
  assert.equal((svg.match(/>0</g) ?? []).length, 1, "the origin's \"0\" label is only drawn once, on the y-axis");
});

test("axesToSvgElements: viewport entirely above y=0 hugs the x-axis to the bottom edge and flips its labels above the line", () => {
  const svg = axesToSvgElements({ xMin: -1, xMax: 1, yMin: 1, yMax: 3 }, 100, 100);
  assert.ok(svg.includes(`<line x1="0" y1="100" x2="100" y2="100" stroke="${MUTED}" stroke-width="1" />`), "x-axis hugs the bottom edge (y=100)");
  assert.ok(svg.includes('dominant-baseline="auto"'), "x-axis labels flip above the hugging line");
  assert.ok(!svg.includes('dominant-baseline="hanging"'));
});

test("axesToSvgElements: viewport entirely left of x=0 hugs the y-axis to the right edge, labels stay on their default left side (still on-canvas)", () => {
  const svg = axesToSvgElements({ xMin: -3, xMax: -1, yMin: -1, yMax: 1 }, 100, 100);
  assert.ok(svg.includes(`<line x1="100" y1="0" x2="100" y2="100" stroke="${MUTED}" stroke-width="1" />`), "y-axis hugs the right edge (x=100)");
  assert.ok(svg.includes('text-anchor="end"'), "left-of-axis default labels are still on-canvas when hugging the right edge, so no flip");
  assert.ok(!svg.includes('text-anchor="start"'));
});

test("axesToSvgElements: viewport entirely right of x=0 hugs the y-axis to the left edge and flips its labels to the right (default left side would be off-canvas)", () => {
  const svg = axesToSvgElements({ xMin: 1, xMax: 3, yMin: -1, yMax: 1 }, 100, 100);
  assert.ok(svg.includes(`<line x1="0" y1="0" x2="0" y2="100" stroke="${MUTED}" stroke-width="1" />`), "y-axis hugs the left edge (x=0)");
  assert.ok(svg.includes('text-anchor="start"'), "labels flip to the right of the hugging line");
});

test("axesToSvgElements: a degenerate viewport (max <= min) produces no elements rather than throwing", () => {
  assert.equal(axesToSvgElements({ xMin: 2, xMax: 2, yMin: 0, yMax: 2 }, 100, 100), "");
  assert.equal(axesToSvgElements({ xMin: 0, xMax: 2, yMin: 5, yMax: 1 }, 100, 100), "");
});
