import assert from "node:assert/strict";
import { test } from "node:test";
import { Interval, Symbolic } from "@johnhenry/math";
import { evaluateInterval, nextDown, nextUp } from "./interval-eval.ts";

test("evaluateInterval: matches hand-computed bounds for x^2 over [1,2] ([1,4])", () => {
  const expr = Symbolic.parse("x^2");
  const result = evaluateInterval(expr, { x: new Interval(1, 2) });
  assert.equal(result.lo, 1);
  assert.equal(result.hi, 4);
});

test("evaluateInterval: add/subtract/multiply/negate against hand-computed interval arithmetic", () => {
  const x = new Interval(1, 2);
  const y = new Interval(3, 4);
  assert.deepEqual(evaluateInterval(Symbolic.parse("x + y"), { x, y }), x.add(y));
  assert.deepEqual(evaluateInterval(Symbolic.parse("x - y"), { x, y }), x.subtract(y));
  assert.deepEqual(evaluateInterval(Symbolic.parse("x * y"), { x, y }), x.multiply(y));
  assert.deepEqual(evaluateInterval(Symbolic.parse("-x"), { x }), x.negate());
});

test("evaluateInterval: division by an interval containing zero throws (not a silently-wrong bounded result)", () => {
  const x = new Interval(1, 2);
  const y = new Interval(-1, 1);
  assert.throws(() => evaluateInterval(Symbolic.parse("x / y"), { x, y }), /division by an interval containing zero/);
});

test("evaluateInterval: sqrt/log of an interval touching non-positive values throws", () => {
  const z = new Interval(-1, 1);
  assert.throws(() => evaluateInterval(Symbolic.parse("sqrt(z)"), { z }), /negative/);
  assert.throws(() => evaluateInterval(Symbolic.parse("ln(z)"), { z }), /non-positive/);
});

test("evaluateInterval: pow requires a constant non-negative integer exponent", () => {
  const x = new Interval(1, 2);
  // A degenerate point interval (e.g. y=[2,2], as a literal "2" always
  // parses to) IS a valid constant integer exponent.
  assert.doesNotThrow(() => evaluateInterval(Symbolic.parse("x^y"), { x, y: new Interval(2, 2) }));
  // A genuinely non-degenerate exponent interval, or a non-integer one, is rejected.
  assert.throws(() => evaluateInterval(Symbolic.parse("x^y"), { x, y: new Interval(1, 3) }), /Interval mode only supports/);
  assert.throws(() => evaluateInterval(Symbolic.parse("x^0.5"), { x }), /Interval mode only supports/);
});

test("evaluateInterval: pi and e resolve to degenerate point intervals", () => {
  const piResult = evaluateInterval(Symbolic.parse("pi"), {});
  assert.equal(piResult.lo, Math.PI);
  assert.equal(piResult.hi, Math.PI);
});

test("evaluateInterval: an unbound variable throws a clear error", () => {
  assert.throws(() => evaluateInterval(Symbolic.parse("q"), {}), /"q" is not bound/);
});

test("evaluateInterval: an unsupported function (e.g. asin) throws a clear error", () => {
  assert.throws(() => evaluateInterval(Symbolic.parse("asin(x)"), { x: new Interval(0, 0.5) }), /isn't supported in interval mode/);
});

test("evaluateInterval: tan near an asymptote (cos crosses zero) throws via the underlying divide-by-zero-containing-interval", () => {
  // cos is 0 somewhere in [1, 2] (pi/2 ~ 1.5708), so sin(x)/cos(x) crosses a
  // zero-containing denominator interval.
  assert.throws(() => evaluateInterval(Symbolic.parse("tan(x)"), { x: new Interval(1, 2) }));
});

// Property test (the issue's own suggested oracle): for a random box and
// several random sample points inside it, the interval result must CONTAIN
// the plain float evaluation at every sampled point. A fixed seed keeps the
// sweep reproducible rather than flaky.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("evaluateInterval: property test -- the result interval contains the float evaluation at random points inside a random box, across several expressions", () => {
  const exprSources = ["x^2 + y", "sin(x) * cos(y)", "sqrt(x^2 + y^2)", "exp(x) - ln(y)", "x^3 - 2*x + 1", "abs(x - y)"];
  const rand = mulberry32(42);
  let checkedAtLeastOnce = false;
  for (const src of exprSources) {
    const parsed = Symbolic.parse(src);
    const compiled = Symbolic.compile(src);
    for (let trial = 0; trial < 15; trial++) {
      const xLo = (rand() - 0.5) * 4;
      const xWidth = rand() * 2 + 0.01;
      const yLo = rand() * 3 + 0.5; // keep y positive-ish so ln(y) is often definable
      const yWidth = rand() * 2 + 0.01;
      const xInterval = new Interval(xLo, xLo + xWidth);
      const yInterval = new Interval(yLo, yLo + yWidth);
      let resultInterval: Interval;
      try {
        resultInterval = evaluateInterval(parsed, { x: xInterval, y: yInterval });
      } catch {
        continue; // a genuine domain violation (e.g. ln of a box touching 0) -- not this test's concern
      }
      for (let i = 0; i < 8; i++) {
        const xVal = xLo + rand() * xWidth;
        const yVal = yLo + rand() * yWidth;
        const floatVal = compiled({ x: xVal, y: yVal });
        if (!Number.isFinite(floatVal)) continue;
        checkedAtLeastOnce = true;
        assert.ok(
          floatVal >= resultInterval.lo - 1e-9 && floatVal <= resultInterval.hi + 1e-9,
          `${src}: float value ${floatVal} at (${xVal}, ${yVal}) escaped interval [${resultInterval.lo}, ${resultInterval.hi}] computed over box x=${xInterval} y=${yInterval}`,
        );
      }
    }
  }
  assert.ok(checkedAtLeastOnce, "the property sweep never actually compared anything -- test setup is broken");
});

// -- outward rounding (mallory#305, upstream johnhenry/math#57) ----

test("nextUp/nextDown: step exactly one representable double, symmetric across zero", () => {
  assert.ok(nextUp(1) > 1);
  assert.equal(nextUp(1), 1 + Number.EPSILON);
  assert.ok(nextDown(1) < 1);
  assert.equal(nextUp(0), Number.MIN_VALUE);
  assert.equal(nextDown(0), -Number.MIN_VALUE);
  assert.equal(nextDown(-1), -(1 + Number.EPSILON));
});

test("#305: sqrt(2) on a point interval yields strictly widened bounds that CONTAIN the true value, not a degenerate point", () => {
  const result = evaluateInterval(Symbolic.parse("sqrt(2)"), {});
  assert.ok(result.lo < result.hi, "bounds must differ -- sqrt(2) is irrational, a point interval cannot contain it");
  assert.ok(result.lo < Math.SQRT2 && Math.SQRT2 < result.hi);
  // ...but only barely: exactly 1 ulp of slack each side of the correctly-rounded float.
  assert.equal(nextUp(result.lo), Math.SQRT2);
  assert.equal(nextDown(result.hi), Math.SQRT2);
});

test("outward rounding applies to exp/ln/sin/cos too; abs stays exact", () => {
  for (const src of ["exp(1)", "ln(2)", "sin(1)", "cos(1)"]) {
    const result = evaluateInterval(Symbolic.parse(src), {});
    assert.ok(result.lo < result.hi, `${src} must widen`);
  }
  const absResult = evaluateInterval(Symbolic.parse("abs(-3)"), {});
  assert.equal(absResult.lo, absResult.hi);
});
