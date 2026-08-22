import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSonificationSchedule, xToSweepTime } from "./sonify-curve.ts";

const STROKE = { thickness: 1, color: 0, alpha: 1, pixelHinting: false, scaleMode: "normal", caps: null, joints: null, miterLimit: 3 };
const VIEWPORT = { xMin: 0, xMax: 10, yMin: -1, yMax: 1 };
const PATH = {
  stroke: STROKE,
  commands: [
    { op: "moveTo", x: 0, y: 0 },
    { op: "lineTo", x: 5, y: 1 },
    { op: "lineTo", x: 10, y: -1 },
  ],
} as import("@johnhenry/math").Path2D;

test("xToSweepTime: maps the viewport's x-range linearly onto [0, durationSeconds]", () => {
  assert.equal(xToSweepTime(0, VIEWPORT, 4), 0);
  assert.equal(xToSweepTime(10, VIEWPORT, 4), 4);
  assert.equal(xToSweepTime(5, VIEWPORT, 4), 2);
});

test("xToSweepTime: a degenerate (zero-width) viewport returns 0 rather than dividing by zero", () => {
  assert.equal(xToSweepTime(3, { xMin: 3, xMax: 3, yMin: -1, yMax: 1 }, 5), 0);
});

test("buildSonificationSchedule: returns exactly stepCount steps, evenly spaced in time", () => {
  const schedule = buildSonificationSchedule(PATH, [], VIEWPORT, 4, { stepCount: 5 });
  assert.equal(schedule.length, 5);
  assert.deepEqual(
    schedule.map((s) => s.time),
    [0, 1, 2, 3, 4],
  );
});

test("buildSonificationSchedule: y at the viewport's y-min/y-max maps to the min/max frequency", () => {
  const flatLow: import("@johnhenry/math").Path2D = {
    stroke: STROKE,
    commands: [
      { op: "moveTo", x: 0, y: -1 },
      { op: "lineTo", x: 10, y: -1 },
    ],
  };
  const flatHigh: import("@johnhenry/math").Path2D = {
    stroke: STROKE,
    commands: [
      { op: "moveTo", x: 0, y: 1 },
      { op: "lineTo", x: 10, y: 1 },
    ],
  };
  const low = buildSonificationSchedule(flatLow, [], VIEWPORT, 1, { stepCount: 3, minFrequency: 200, maxFrequency: 800 });
  const high = buildSonificationSchedule(flatHigh, [], VIEWPORT, 1, { stepCount: 3, minFrequency: 200, maxFrequency: 800 });
  assert.ok(low.every((s) => s.frequency === 200));
  assert.ok(high.every((s) => s.frequency === 800));
});

test("buildSonificationSchedule: a step whose x falls inside a discontinuity gap is silent (frequency: null)", () => {
  const gapPath: import("@johnhenry/math").Path2D = {
    stroke: STROKE,
    commands: [
      { op: "moveTo", x: 0, y: 0 },
      { op: "lineTo", x: 4, y: 0 },
      { op: "moveTo", x: 6, y: 0 },
      { op: "lineTo", x: 10, y: 0 },
    ],
  };
  const schedule = buildSonificationSchedule(gapPath, [{ before: { x: 4, y: 0 }, after: { x: 6, y: 0 } }], VIEWPORT, 10, { stepCount: 11 });
  const gapStep = schedule.find((s) => s.time === 5);
  assert.ok(gapStep);
  assert.equal(gapStep!.frequency, null);
  const outsideStep = schedule.find((s) => s.time === 0);
  assert.notEqual(outsideStep!.frequency, null);
});

test("buildSonificationSchedule: an empty path produces an all-silent schedule of the right length, not a crash", () => {
  const empty: import("@johnhenry/math").Path2D = { stroke: STROKE, commands: [] };
  const schedule = buildSonificationSchedule(empty, [], VIEWPORT, 2, { stepCount: 4 });
  assert.equal(schedule.length, 4);
  assert.ok(schedule.every((s) => s.frequency === null));
});
