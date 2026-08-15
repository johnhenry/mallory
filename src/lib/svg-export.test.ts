import assert from "node:assert/strict";
import { test } from "node:test";
import {
  pathToSvgD,
  pathsToSvgDocument,
  polylinePointsToSvgD,
  polylineToSvgDocument,
  polylinesToSvgDocument,
  scatterPointsToSvgDocument,
  svgExportFilename,
} from "./svg-export.ts";

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
  const svg = pathsToSvgDocument([], VIEWPORT, 50, 50);
  assert.equal(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 50 50">\n\n</svg>');
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
  const svg = polylineToSvgDocument([], VIEWPORT, 50, 50);
  assert.equal(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 50 50">\n\n</svg>');
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
  const svg = polylinesToSvgDocument([], VIEWPORT, 50, 50);
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
  const svg = scatterPointsToSvgDocument([], VIEWPORT, 50, 50);
  assert.equal(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 50 50">\n\n</svg>');
});
