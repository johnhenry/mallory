import assert from "node:assert/strict";
import { test } from "node:test";
import { pathToSvgD, pathsToSvgDocument, svgExportFilename } from "./svg-export.ts";

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
