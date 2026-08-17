import assert from "node:assert/strict";
import { test } from "node:test";
import { describeCurve } from "./graph-description.ts";

const VIEWPORT = { xMin: -5, xMax: 5, yMin: -3, yMax: 3 };

test("describeCurve: no events at all reports that plainly", () => {
  assert.equal(describeCurve(null, VIEWPORT, [], { maxima: [], minima: [] }, []), "no roots, extrema, or discontinuities found in the current view.");
});

test("describeCurve: an optional label is prefixed with a colon; omitting it drops the prefix", () => {
  const withLabel = describeCurve("f(x) = x", VIEWPORT, [{ x: 0, y: 0 }], { maxima: [], minima: [] }, []);
  assert.ok(withLabel.startsWith("f(x) = x: "));
  const withoutLabel = describeCurve(null, VIEWPORT, [{ x: 0, y: 0 }], { maxima: [], minima: [] }, []);
  assert.ok(withoutLabel.startsWith("root at x=0"));
});

test("describeCurve: roots, maxima, and minima are all mentioned by name", () => {
  const text = describeCurve(
    null,
    VIEWPORT,
    [{ x: 0.5, y: 0 }],
    { maxima: [{ x: 1.2, y: 0.98, prominence: 0.5 }], minima: [{ x: -1.3, y: -0.99, prominence: 0.5 }] },
    [],
  );
  assert.match(text, /root at x=0\.5/);
  assert.match(text, /local max near x=1\.2 \(y=0\.98\)/);
  assert.match(text, /local min near x=-1\.3 \(y=-0\.99\)/);
});

test("describeCurve: events are ordered left-to-right by x, regardless of input order", () => {
  const text = describeCurve(
    null,
    VIEWPORT,
    [{ x: 2, y: 0 }],
    { maxima: [{ x: -2, y: 1, prominence: 1 }], minima: [] },
    [],
  );
  const maxIdx = text.indexOf("local max");
  const rootIdx = text.indexOf("root at");
  assert.ok(maxIdx >= 0 && rootIdx >= 0 && maxIdx < rootIdx, `expected the x=-2 max before the x=2 root: "${text}"`);
});

test("describeCurve: a gap whose y-values sit at the viewport's y-edges reads as a vertical asymptote", () => {
  const text = describeCurve(null, VIEWPORT, [], { maxima: [], minima: [] }, [{ before: { x: 2.9, y: 2.99 }, after: { x: 3.1, y: -2.98 } }]);
  assert.match(text, /vertical asymptote near x=3/);
});

test("describeCurve: a gap whose y-values sit mid-range (not near the viewport edges) reads as a plain gap, not an asymptote", () => {
  const text = describeCurve(null, VIEWPORT, [], { maxima: [], minima: [] }, [{ before: { x: 2.9, y: 0.1 }, after: { x: 3.1, y: -0.1 } }]);
  assert.match(text, /gap near x=3/);
  assert.doesNotMatch(text, /asymptote/);
});

test("describeCurve: caps at 6 events and appends a '+N more' tail rather than listing every one", () => {
  const roots = Array.from({ length: 10 }, (_, i) => ({ x: i, y: 0 }));
  const text = describeCurve(null, VIEWPORT, roots, { maxima: [], minima: [] }, []);
  const mentioned = text.match(/root at x=\d+/g) ?? [];
  assert.equal(mentioned.length, 6);
  assert.match(text, /and 4 more\.$/);
});
