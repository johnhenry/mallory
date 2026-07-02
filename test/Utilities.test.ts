import assert from "node:assert/strict";
import { test } from "node:test";
import { Utilities } from "../src/Utilities.ts";

test("roundTo default precision", () => {
  assert.equal(Utilities.roundTo(1.123456789), 1.12345679);
  assert.equal(Utilities.roundTo(3.14159265, 2), 3.14);
});

test("roundTo clamps extremes", () => {
  assert.equal(Utilities.roundTo(Number.MAX_VALUE), Number.POSITIVE_INFINITY);
  assert.equal(Utilities.roundTo(-Number.MAX_VALUE), Number.NEGATIVE_INFINITY);
  assert.equal(Utilities.roundTo(0), 0);
});

test("angle conversions round-trip", () => {
  assert.ok(Math.abs(Utilities.degreesToRadians(180) - Math.PI) < 1e-12);
  assert.ok(Math.abs(Utilities.radiansToDegrees(Math.PI) - 180) < 1e-12);
});

test("cloneArray produces an independent copy", () => {
  const a = [1, 2, 3];
  const b = Utilities.cloneArray(a);
  b[0] = 99;
  assert.deepEqual(a, [1, 2, 3]);
});

test("mapArray", () => {
  assert.deepEqual(
    Utilities.mapArray([1, 2, 3], (x) => x * 2),
    [2, 4, 6],
  );
});

test("isMember uses loose equality", () => {
  assert.equal(Utilities.isMember(2, [1, 2, 3]), true);
  assert.equal(Utilities.isMember("2", [1, 2, 3]), true);
  assert.equal(Utilities.isMember(9, [1, 2, 3]), false);
});
