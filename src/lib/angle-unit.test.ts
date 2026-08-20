import assert from "node:assert/strict";
import { test } from "node:test";
import { angleUnitSuffix, formatAngle, radiansToUnit, unitToDegrees, unitToRadians } from "./angle-unit.ts";

test("radiansToUnit is a no-op for radians and converts to degrees", () => {
  assert.equal(radiansToUnit(Math.PI, "radians"), Math.PI);
  assert.equal(radiansToUnit(Math.PI, "degrees"), 180);
});

test("unitToRadians is a no-op for radians and converts from degrees", () => {
  assert.equal(unitToRadians(Math.PI, "radians"), Math.PI);
  assert.equal(unitToRadians(180, "degrees"), Math.PI);
});

test("unitToDegrees is a no-op for degrees and converts from radians", () => {
  assert.equal(unitToDegrees(180, "degrees"), 180);
  assert.equal(unitToDegrees(Math.PI, "radians"), 180);
});

test("angleUnitSuffix", () => {
  assert.equal(angleUnitSuffix("degrees"), "°");
  assert.equal(angleUnitSuffix("radians"), " rad");
});

test("formatAngle renders in the requested unit with its suffix", () => {
  assert.equal(formatAngle(Math.PI, "degrees"), "180.0°");
  assert.equal(formatAngle(Math.PI, "radians", 4), "3.1416 rad");
});
