import assert from "node:assert/strict";
import { test } from "node:test";
import {
  arcToSvgD,
  axesToSvgElements,
  layersToSvgDocument,
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

test("layersToSvgDocument: a scatter layer under a polyline layer produces both element kinds, in array order, using drawScatter/drawPolyline's own defaults", () => {
  const scatterPoints = [{ x: 0, y: 0 }];
  const polylinePoints = [
    { x: 0, y: 0 },
    { x: 2, y: 2 },
  ];
  const svg = layersToSvgDocument(
    [
      { kind: "scatter", points: scatterPoints, color: "#93c5fd", radius: 2.5 },
      { kind: "polyline", points: polylinePoints, color: "#dc2626" },
    ],
    VIEWPORT,
    100,
    100,
  );
  // toScreenX(0)=0,toScreenY(0)=100 -- matches scatterPointsToSvgDocument's own hand-computed case.
  assert.ok(svg.includes('<circle cx="0.00" cy="100.00" r="2.5" fill="#93c5fd" />'));
  assert.ok(svg.includes(`<path d="${polylinePointsToSvgD(polylinePoints, VIEWPORT, 100, 100)}" fill="none" stroke="#dc2626" stroke-width="1.5" />`));
  // scatter (array index 0) must appear before polyline (index 1) -- same layering order as the draw calls it mirrors.
  assert.ok(svg.indexOf("<circle") < svg.indexOf("<path"));
});

test("layersToSvgDocument: polyline layer defaults to drawPolyline's own blue/1.5px, scatter layer defaults to drawScatter's own blue/5px", () => {
  const svg = layersToSvgDocument(
    [
      { kind: "polyline", points: [{ x: 0, y: 0 }] },
      { kind: "scatter", points: [{ x: 1, y: 1 }] },
    ],
    VIEWPORT,
    100,
    100,
  );
  assert.ok(svg.includes('stroke="#2563eb" stroke-width="1.5"'));
  assert.ok(svg.includes('r="5" fill="#2563eb"'));
});

test("layersToSvgDocument: a polyline layer's dash produces a stroke-dasharray attribute matching setLineDash's own array", () => {
  const svg = layersToSvgDocument(
    [{ kind: "polyline", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: "#9ca3af", dash: [4, 4] }],
    VIEWPORT,
    100,
    100,
  );
  assert.ok(svg.includes('stroke="#9ca3af" stroke-width="1.5" stroke-dasharray="4 4" />'));
});

test("layersToSvgDocument: a polyline layer with no dash (or an empty dash array) omits stroke-dasharray entirely, matching a solid ctx line", () => {
  const noDash = layersToSvgDocument([{ kind: "polyline", points: [{ x: 0, y: 0 }] }], VIEWPORT, 100, 100);
  assert.ok(!noDash.includes("stroke-dasharray"));
  const emptyDash = layersToSvgDocument([{ kind: "polyline", points: [{ x: 0, y: 0 }], dash: [] }], VIEWPORT, 100, 100);
  assert.ok(!emptyDash.includes("stroke-dasharray"));
});

test("layersToSvgDocument: a histogram layer's bin produces a hand-computed <rect>, using drawHistogram's own light-blue/blue defaults", () => {
  // viewport [0,4]x[0,10] on a 100x100 canvas: toScreenX(0)=0, toScreenX(2)=50,
  // toScreenY(0)=100 (zeroY), toScreenY(5)=50 -- bin [0,2] count=5 is a rect
  // from x=0 to x=50, y=50 (top, higher count) down to y=100 (zero line).
  const svg = layersToSvgDocument([{ kind: "histogram", bins: [{ x0: 0, x1: 2, count: 5 }] }], { xMin: 0, xMax: 4, yMin: 0, yMax: 10 }, 100, 100);
  assert.ok(svg.includes('<rect x="0.00" y="50.00" width="50.00" height="50.00" fill="#93c5fd" stroke="#2563eb" stroke-width="1" />'));
});

test("layersToSvgDocument: a histogram layer's custom color/strokeColor override drawHistogram's own defaults", () => {
  const svg = layersToSvgDocument(
    [{ kind: "histogram", bins: [{ x0: 0, x1: 2, count: 5 }], color: "#facc15", strokeColor: "#a16207" }],
    { xMin: 0, xMax: 4, yMin: 0, yMax: 10 },
    100,
    100,
  );
  assert.ok(svg.includes('fill="#facc15" stroke="#a16207"'));
});

test("layersToSvgDocument: multiple histogram bins each produce their own <rect>, one per bin in array order", () => {
  const svg = layersToSvgDocument(
    [
      {
        kind: "histogram",
        bins: [
          { x0: 0, x1: 2, count: 5 },
          { x0: 2, x1: 4, count: 10 },
        ],
      },
    ],
    { xMin: 0, xMax: 4, yMin: 0, yMax: 10 },
    100,
    100,
  );
  assert.equal((svg.match(/<rect/g) ?? []).length, 2);
  // Second bin's count=10 hits yMax exactly -> toScreenY(10)=0, so its rect spans the full canvas height (y=0, height=100).
  assert.ok(svg.includes('<rect x="50.00" y="0.00" width="50.00" height="100.00"'));
});

test("layersToSvgDocument: a histogram layer with an empty bins array is skipped entirely, not emitted as a stray empty element", () => {
  const svg = layersToSvgDocument([{ kind: "histogram", bins: [] }], VIEWPORT, 100, 100);
  assert.equal((svg.match(/<rect/g) ?? []).length, 0);
});

test("layersToSvgDocument: a slopefield layer's segment is hand-computed, matching drawSlopeField's screen-space-flip angle math", () => {
  // viewport [-1,1]x[-1,1] on a 100x100 canvas: toScreenX(0)=50, toScreenY(0)=50.
  // slope=1 -> angle=atan2(-1,1)=-pi/4 -> dx=8*cos(-pi/4)=5.65685, dy=8*sin(-pi/4)=-5.65685.
  // Segment endpoints: (50-5.65685, 50-(-5.65685))=(44.34,55.66) to (50+5.65685, 50+(-5.65685))=(55.66,44.34) -- tilts up-right on screen for a positive slope.
  const svg = layersToSvgDocument([{ kind: "slopefield", points: [{ x: 0, y: 0, slope: 1 }] }], { xMin: -1, xMax: 1, yMin: -1, yMax: 1 }, 100, 100);
  assert.ok(svg.includes('<line x1="44.34" y1="55.66" x2="55.66" y2="44.34" stroke="rgba(37, 99, 235, 0.5)" stroke-width="1.5" />'));
});

test("layersToSvgDocument: a slopefield layer's custom color/halfLengthPx override drawSlopeField's own defaults", () => {
  const svg = layersToSvgDocument(
    [{ kind: "slopefield", points: [{ x: 0, y: 0, slope: 0 }], color: "#f97316", halfLengthPx: 4 }],
    { xMin: -1, xMax: 1, yMin: -1, yMax: 1 },
    100,
    100,
  );
  // slope=0 -> angle=atan2(0,1)=0 -> horizontal segment of half-length 4 either side of (50,50).
  assert.ok(svg.includes('<line x1="46.00" y1="50.00" x2="54.00" y2="50.00" stroke="#f97316" stroke-width="1.5" />'));
});

test("layersToSvgDocument: multiple slopefield points each produce their own <line>, and a slopefield layer with no points is skipped entirely", () => {
  const svg = layersToSvgDocument(
    [
      {
        kind: "slopefield",
        points: [
          { x: 0, y: 0, slope: 0 },
          { x: 0.5, y: 0.5, slope: -1 },
        ],
      },
    ],
    { xMin: -1, xMax: 1, yMin: -1, yMax: 1 },
    100,
    100,
    false,
  );
  assert.equal((svg.match(/<line/g) ?? []).length, 2);

  const empty = layersToSvgDocument([{ kind: "slopefield", points: [] }], VIEWPORT, 100, 100, false);
  assert.equal((empty.match(/<line/g) ?? []).length, 0);
});

test("layersToSvgDocument: a vectorfield layer's arrow is hand-computed (via a standalone node script matching drawVectorField's own formulas), shaft + arrowhead polygon", () => {
  // viewport [-1,1]x[-1,1] on a 100x100 canvas, point (0,0) with dx=1,dy=1 (45-degree flow).
  const svg = layersToSvgDocument([{ kind: "vectorfield", points: [{ x: 0, y: 0, dx: 1, dy: 1 }] }], { xMin: -1, xMax: 1, yMin: -1, yMax: 1 }, 100, 100);
  assert.ok(svg.includes('<line x1="44.34" y1="55.66" x2="55.66" y2="44.34" stroke="rgba(37, 99, 235, 0.55)" stroke-width="1.5" />'));
  assert.ok(svg.includes('<polygon points="55.66,44.34 54.41,48.98 51.02,45.59" fill="rgba(37, 99, 235, 0.55)" />'));
  // Shaft precedes its own arrowhead.
  assert.ok(svg.indexOf("<line") < svg.indexOf("<polygon"));
});

test("layersToSvgDocument: a vectorfield layer's custom color/halfLengthPx override drawVectorField's own defaults", () => {
  const svg = layersToSvgDocument(
    [{ kind: "vectorfield", points: [{ x: 0, y: 0, dx: 1, dy: 0 }], color: "#16a34a", halfLengthPx: 4 }],
    { xMin: -1, xMax: 1, yMin: -1, yMax: 1 },
    100,
    100,
  );
  assert.ok(svg.includes('stroke="#16a34a"'));
  assert.ok(svg.includes('fill="#16a34a"'));
  // halfLengthPx=4 halves every offset from the halfLengthPx=8 case -- shaft spans a 4px radius around (50,50) along +x.
  assert.ok(svg.includes('<line x1="46.00" y1="50.00" x2="54.00" y2="50.00"'));
});

test("layersToSvgDocument: a vectorfield point with near-zero magnitude is skipped (matching drawVectorField's own 1e-12 threshold), and an empty points array produces no arrows", () => {
  const svg = layersToSvgDocument(
    [
      {
        kind: "vectorfield",
        points: [
          { x: 0, y: 0, dx: 0, dy: 0 },
          { x: 0.5, y: 0.5, dx: 1e-13, dy: 1e-13 },
          { x: -0.5, y: -0.5, dx: 1, dy: 0 },
        ],
      },
    ],
    { xMin: -1, xMax: 1, yMin: -1, yMax: 1 },
    100,
    100,
    false,
  );
  assert.equal((svg.match(/<line/g) ?? []).length, 1);
  assert.equal((svg.match(/<polygon/g) ?? []).length, 1);

  const empty = layersToSvgDocument([{ kind: "vectorfield", points: [] }], VIEWPORT, 100, 100, false);
  assert.equal((empty.match(/<line/g) ?? []).length, 0);
});

test("layersToSvgDocument: a band layer's polygon traces the upper boundary forward then the lower boundary backward, hand-computed", () => {
  // viewport [0,2]x[0,10] on a 100x100 canvas: toScreenX(0)=0, toScreenX(2)=100.
  // toScreenY(8)=20, toScreenY(6)=40, toScreenY(4)=60, toScreenY(2)=80.
  const svg = layersToSvgDocument(
    [
      {
        kind: "band",
        points: [
          { x: 0, yLow: 2, yHigh: 8 },
          { x: 2, yLow: 4, yHigh: 6 },
        ],
      },
    ],
    { xMin: 0, xMax: 2, yMin: 0, yMax: 10 },
    100,
    100,
  );
  assert.ok(svg.includes('<polygon points="0.00,20.00 100.00,40.00 100.00,60.00 0.00,80.00" fill="rgba(37, 99, 235, 0.15)" />'));
});

test("layersToSvgDocument: a band layer's custom color overrides its own default fill", () => {
  const svg = layersToSvgDocument(
    [{ kind: "band", points: [{ x: 0, yLow: 0, yHigh: 1 }], color: "#fecaca" }],
    { xMin: 0, xMax: 1, yMin: 0, yMax: 1 },
    100,
    100,
  );
  assert.ok(svg.includes('fill="#fecaca"'));
});

test("layersToSvgDocument: a band layer with an empty points array is skipped entirely, not emitted as a stray empty <polygon>", () => {
  const svg = layersToSvgDocument([{ kind: "band", points: [] }], VIEWPORT, 100, 100);
  assert.equal((svg.match(/<polygon/g) ?? []).length, 0);
});

test("layersToSvgDocument: a labeled-markers layer's circle+text pair is hand-computed, matching OdeSystemPanel's fixed-point marker placement", () => {
  // viewport [-1,1]x[-1,1] on a 100x100 canvas: toScreenX(0)=50, toScreenY(0)=50.
  // Label offset is +9,-9 from the marker center, matching ctx.fillText(label, sx+9, sy-9).
  // axes=false to isolate this layer's own <text> from the axis tick labels' <text> elements.
  const svg = layersToSvgDocument(
    [{ kind: "labeled-markers", points: [{ x: 0, y: 0, color: "#f59e0b", label: "Saddle" }] }],
    { xMin: -1, xMax: 1, yMin: -1, yMax: 1 },
    100,
    100,
    false,
  );
  assert.ok(svg.includes(`<circle cx="50.00" cy="50.00" r="6" fill="#f59e0b" stroke="${INK}" stroke-width="1.5" />`));
  assert.ok(svg.includes(`<text x="59.00" y="41.00" fill="${INK}" font-size="11" font-family="sans-serif">Saddle</text>`));
  // Circle precedes its own text label.
  assert.ok(svg.indexOf("<circle") < svg.indexOf("<text"));
});

test("layersToSvgDocument: a labeled-markers layer's custom radius overrides the default 6px, and multiple points each get their own circle+text pair", () => {
  const svg = layersToSvgDocument(
    [
      {
        kind: "labeled-markers",
        points: [
          { x: 0, y: 0, color: "#2563eb", label: "Stable node" },
          { x: 0.5, y: 0.5, color: "#dc2626", label: "Unstable node" },
        ],
        radius: 3,
      },
    ],
    { xMin: -1, xMax: 1, yMin: -1, yMax: 1 },
    100,
    100,
    false,
  );
  assert.equal((svg.match(/<circle/g) ?? []).length, 2);
  assert.equal((svg.match(/<text/g) ?? []).length, 2);
  assert.ok(svg.includes('r="3"'));
  assert.ok(!svg.includes('r="6"'));
});

test("layersToSvgDocument: a labeled-markers layer with an empty points array is skipped entirely", () => {
  const svg = layersToSvgDocument([{ kind: "labeled-markers", points: [] }], VIEWPORT, 100, 100, false);
  assert.equal((svg.match(/<circle/g) ?? []).length, 0);
  assert.equal((svg.match(/<text/g) ?? []).length, 0);
});

test("layersToSvgDocument: a layer with an empty points array is skipped entirely, not emitted as a stray empty element", () => {
  const svg = layersToSvgDocument(
    [
      { kind: "polyline", points: [] },
      { kind: "scatter", points: [{ x: 0, y: 0 }] },
    ],
    VIEWPORT,
    100,
    100,
  );
  assert.equal((svg.match(/<path/g) ?? []).length, 0);
  assert.equal((svg.match(/<circle/g) ?? []).length, 1);
});

test("layersToSvgDocument: an empty layers array produces a valid (empty) SVG document", () => {
  const svg = layersToSvgDocument([], VIEWPORT, 50, 50, false);
  assert.equal(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 50 50">\n\n</svg>');
});

test("layersToSvgDocument: axes default on, prepended before every layer's own elements", () => {
  const svg = layersToSvgDocument([{ kind: "scatter", points: [{ x: 0, y: 0 }] }], VIEWPORT, 50, 50);
  assert.ok(svg.includes("<line"));
  assert.ok(svg.indexOf("<line") < svg.indexOf("<circle"));
});

test("layersToSvgDocument: a path layer draws the Path2D's own stroke color/opacity/width, matching pathsToSvgDocument's own convention -- not the color/strokeWidth override the point-array kinds take", () => {
  const path = {
    stroke: { thickness: 2, color: 0xdc2626, alpha: 0.5, pixelHinting: false, scaleMode: "normal", caps: null, joints: null, miterLimit: 3 },
    commands: [
      { op: "moveTo" as const, x: 0, y: 0 },
      { op: "lineTo" as const, x: 1, y: 1 },
    ],
  };
  const svg = layersToSvgDocument([{ kind: "path", path }], VIEWPORT, 100, 100);
  assert.ok(svg.includes(`<path d="${pathToSvgD(path, VIEWPORT, 100, 100)}" fill="none" stroke="#dc2626" stroke-opacity="0.5" stroke-width="2" />`));
});

test("layersToSvgDocument: scatter, path, and polyline layers combine in array order, each using its own kind's rendering", () => {
  const scatterPoints = [{ x: 0, y: 0 }];
  const path = {
    stroke: { thickness: 1, color: 0, alpha: 1, pixelHinting: false, scaleMode: "normal", caps: null, joints: null, miterLimit: 3 },
    commands: [
      { op: "moveTo" as const, x: 0, y: 0 },
      { op: "lineTo" as const, x: 2, y: 2 },
    ],
  };
  const polylinePoints = [{ x: 1, y: 1 }];
  const svg = layersToSvgDocument(
    [
      { kind: "scatter", points: scatterPoints, color: "#93c5fd" },
      { kind: "path", path },
      { kind: "polyline", points: polylinePoints, color: "#f59e0b" },
    ],
    VIEWPORT,
    100,
    100,
  );
  const circleIdx = svg.indexOf('fill="#93c5fd"');
  const pathIdx = svg.indexOf(`d="${pathToSvgD(path, VIEWPORT, 100, 100)}"`);
  const polylineIdx = svg.indexOf('stroke="#f59e0b"');
  assert.ok(circleIdx >= 0 && pathIdx >= 0 && polylineIdx >= 0);
  assert.ok(circleIdx < pathIdx && pathIdx < polylineIdx);
});

test("layersToSvgDocument: a path layer with no commands is skipped, not emitted as a stray empty <path>", () => {
  const emptyPath = {
    stroke: { thickness: 1, color: 0, alpha: 1, pixelHinting: false, scaleMode: "normal", caps: null, joints: null, miterLimit: 3 },
    commands: [],
  };
  const svg = layersToSvgDocument([{ kind: "path", path: emptyPath }, { kind: "scatter", points: [{ x: 0, y: 0 }] }], VIEWPORT, 100, 100);
  assert.equal((svg.match(/<path/g) ?? []).length, 0);
  assert.equal((svg.match(/<circle/g) ?? []).length, 1);
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

test("arcToSvgD: a quarter-circle anticlockwise sweep, hand-computed (verified via a standalone node script implementing the same trig)", () => {
  // cx=0,cy=0,r=10, start angle 0 (pointing +x), end angle -pi/2 (pointing -y, i.e. "up" on screen).
  // anticlockwise=true -> sweepAngle=pi/2 (<=pi so largeArcFlag=0), sweepFlag=0.
  assert.equal(arcToSvgD(0, 0, 10, 0, -Math.PI / 2, true), "M10.00 0.00 A10.00 10.00 0 0 0 0.00 -10.00");
});

test("arcToSvgD: the same quarter sweep clockwise (anticlockwise=false) flips both the endpoint and the sweep-flag", () => {
  // Same start angle, but end angle +pi/2 (pointing +y, "down" on screen) and anticlockwise=false.
  assert.equal(arcToSvgD(0, 0, 10, 0, Math.PI / 2, false), "M10.00 0.00 A10.00 10.00 0 0 1 0.00 10.00");
});

test("arcToSvgD: a sweep exceeding 180 degrees sets largeArcFlag=1", () => {
  // 270-degree clockwise sweep from angle 0.
  const d = arcToSvgD(0, 0, 5, 0, (3 * Math.PI) / 2, false);
  assert.equal(d, "M5.00 0.00 A5.00 5.00 0 1 1 -0.00 -5.00");
});

test("arcToSvgD: a sweep of EXACTLY 180 degrees stays largeArcFlag=0 (the > boundary, not >=)", () => {
  const d = arcToSvgD(0, 0, 5, 0, Math.PI, false);
  assert.equal(d, "M5.00 0.00 A5.00 5.00 0 0 1 -5.00 0.00");
});

test("arcToSvgD: an off-origin center offsets both endpoints by (cx,cy)", () => {
  assert.equal(arcToSvgD(100, 50, 20, Math.PI / 2, Math.PI, false), "M100.00 70.00 A20.00 20.00 0 0 1 80.00 50.00");
});

test("layersToSvgDocument: a circle layer's radius is scaled from data-space by the viewport's x-span and WIDTH specifically (not height), matching drawCircle's own scaling exactly", () => {
  // viewport [-5,5]x[-5,5] on a deliberately non-square 500x300 canvas (catches a width/height mixup a square
  // canvas couldn't): toScreenX(0,...,500)=250, toScreenY(0,...,300)=150.
  // A data-space radius of 2 scales to (2/10)*500 = 100px -- WIDTH only, unaffected by height=300.
  const svg = layersToSvgDocument([{ kind: "circle", cx: 0, cy: 0, radius: 2 }], { xMin: -5, xMax: 5, yMin: -5, yMax: 5 }, 500, 300, false);
  assert.ok(svg.includes('<circle cx="250.00" cy="150.00" r="100.00" fill="none" stroke="#16a34a" stroke-width="2" />'));
});

test("layersToSvgDocument: a circle layer's custom color/strokeWidth override its own defaults", () => {
  const svg = layersToSvgDocument(
    [{ kind: "circle", cx: 0, cy: 0, radius: 1, color: "#d97706", strokeWidth: 1 }],
    { xMin: -1, xMax: 1, yMin: -1, yMax: 1 },
    100,
    100,
    false,
  );
  assert.ok(svg.includes('stroke="#d97706" stroke-width="1"'));
  assert.ok(svg.includes('fill="none"'));
});

test("layersToSvgDocument: an arc layer wraps arcToSvgD's own output verbatim, using already-screen-space coordinates (no viewport transform applied)", () => {
  const svg = layersToSvgDocument(
    [{ kind: "arc", cxPx: 250, cyPx: 250, radiusPx: 20, startAngle: 0, endAngle: -Math.PI / 2, anticlockwise: true, color: "#9333ea" }],
    // A viewport/size deliberately mismatched from the pixel coordinates above -- proves the arc layer ignores them entirely.
    { xMin: 0, xMax: 1, yMin: 0, yMax: 1 },
    10,
    10,
    false,
  );
  const expectedD = arcToSvgD(250, 250, 20, 0, -Math.PI / 2, true);
  assert.ok(svg.includes(`<path d="${expectedD}" fill="none" stroke="#9333ea" stroke-width="1.5" />`));
});

test("layersToSvgDocument: an arc layer defaults anticlockwise to false and uses its own default color/strokeWidth when omitted", () => {
  const svg = layersToSvgDocument([{ kind: "arc", cxPx: 0, cyPx: 0, radiusPx: 5, startAngle: 0, endAngle: Math.PI / 2 }], VIEWPORT, 100, 100, false);
  assert.ok(svg.includes(arcToSvgD(0, 0, 5, 0, Math.PI / 2, false)));
  assert.ok(svg.includes('stroke="#9333ea" stroke-width="1.5"'));
});

test("layersToSvgDocument: a text layer uses already-screen-space coordinates and drawAngle/drawPolygon's own center-anchored convention", () => {
  const svg = layersToSvgDocument([{ kind: "text", xPx: 42, yPx: 17, label: "3.14", color: "#dc2626" }], VIEWPORT, 100, 100, false);
  assert.ok(svg.includes('<text x="42.00" y="17.00" fill="#dc2626" font-size="12" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">3.14</text>'));
});

test("layersToSvgDocument: a text layer's default color falls back to the theme's muted color, and fontSize defaults to 12", () => {
  const svg = layersToSvgDocument([{ kind: "text", xPx: 0, yPx: 0, label: "x" }], VIEWPORT, 100, 100, false);
  assert.ok(svg.includes(`fill="${MUTED}"`));
  assert.ok(svg.includes('font-size="12"'));
});

test("layersToSvgDocument: circle/arc/text layers are never filtered out as 'empty' (they represent exactly one shape each, unlike the array-based kinds)", () => {
  const svg = layersToSvgDocument(
    [
      { kind: "circle", cx: 0, cy: 0, radius: 1 },
      { kind: "arc", cxPx: 0, cyPx: 0, radiusPx: 1, startAngle: 0, endAngle: 1 },
      { kind: "text", xPx: 0, yPx: 0, label: "x" },
    ],
    VIEWPORT,
    100,
    100,
    false,
  );
  assert.equal((svg.match(/<circle/g) ?? []).length, 1);
  assert.equal((svg.match(/<path/g) ?? []).length, 1);
  assert.equal((svg.match(/<text/g) ?? []).length, 1);
});
