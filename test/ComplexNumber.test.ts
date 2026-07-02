import assert from "node:assert/strict";
import { test } from "node:test";
import { ComplexNumber } from "../src/ComplexNumber.ts";

test("constructor: empty is zero", () => {
  const z = new ComplexNumber();
  assert.equal(z.value, 0);
  assert.equal(z.iValue, 0);
});

test("constructor: (re, im)", () => {
  const z = new ComplexNumber(3, -2);
  assert.equal(z.value, 3);
  assert.equal(z.iValue, -2);
  assert.equal(z.re, 3);
  assert.equal(z.im, -2);
});

test("constructor: copy from ComplexNumber", () => {
  const a = new ComplexNumber(1, 2);
  const b = new ComplexNumber(a);
  assert.ok(b.equals(a));
  b.value = 9;
  assert.equal(a.value, 1, "copy must be independent");
});

test("constructor: from numeric string", () => {
  const z = new ComplexNumber("3+2*i");
  assert.equal(z.value, 3);
  assert.equal(z.iValue, 2);
});

test("re/im aliases write through", () => {
  const z = new ComplexNumber();
  z.re = 5;
  z.im = 7;
  assert.equal(z.value, 5);
  assert.equal(z.iValue, 7);
});

test("isComplex / isNotComplex", () => {
  assert.equal(ComplexNumber.isComplex(3), true);
  assert.equal(ComplexNumber.isComplex("3+2*i"), true);
  assert.equal(ComplexNumber.isComplex("banana"), false);
  assert.equal(ComplexNumber.isNotComplex("banana"), true);
  assert.equal(ComplexNumber.isComplex({}), false);
});

test("parse: real number does not throw (AS3 crash bug fixed)", () => {
  const z = ComplexNumber.parse("3.5");
  assert.equal(z.value, 3.5);
  assert.equal(z.iValue, 0);
});

test("parse: pure imaginary forms", () => {
  assert.ok(ComplexNumber.parse("i").equals(new ComplexNumber(0, 1)));
  assert.ok(ComplexNumber.parse("-i").equals(new ComplexNumber(0, -1)));
  assert.ok(ComplexNumber.parse("2*i").equals(new ComplexNumber(0, 2)));
  assert.ok(ComplexNumber.parse("2i").equals(new ComplexNumber(0, 2)));
  assert.ok(ComplexNumber.parse("-2.5i").equals(new ComplexNumber(0, -2.5)));
});

test("parse: full complex forms with either sign", () => {
  assert.ok(ComplexNumber.parse("3+2*i").equals(new ComplexNumber(3, 2)));
  assert.ok(ComplexNumber.parse("3-2*i").equals(new ComplexNumber(3, -2)));
  assert.ok(ComplexNumber.parse("3+2i").equals(new ComplexNumber(3, 2)));
  assert.ok(ComplexNumber.parse("-3-2i").equals(new ComplexNumber(-3, -2)));
  assert.ok(ComplexNumber.parse("-3+i").equals(new ComplexNumber(-3, 1)));
});

test("parse: garbage yields NaCN", () => {
  assert.ok(ComplexNumber.isNotComplex(ComplexNumber.parse("hello")));
  assert.ok(ComplexNumber.isNotComplex(ComplexNumber.parse("")));
});

test("toString: canonical forms", () => {
  assert.equal(new ComplexNumber(0, 0).toString(), "0");
  assert.equal(new ComplexNumber(3, 0).toString(), "3");
  assert.equal(new ComplexNumber(0, 1).toString(), "i");
  assert.equal(new ComplexNumber(0, -1).toString(), "-i");
  assert.equal(new ComplexNumber(0, 2).toString(), "2*i");
  assert.equal(new ComplexNumber(3, 2).toString(), "3+2*i");
});

test("toString: negative imaginary renders as a-b*i (bug fix)", () => {
  assert.equal(new ComplexNumber(3, -2).toString(), "3-2*i");
  assert.equal(new ComplexNumber(3, -1).toString(), "3-i");
});

test("toString round-trips through parse", () => {
  for (const [re, im] of [
    [3, 2],
    [3, -2],
    [-3, -2],
    [0, 5],
    [0, -5],
    [7, 0],
    [-4, 1],
    [2, -1],
  ] as const) {
    const z = new ComplexNumber(re, im);
    const back = ComplexNumber.parse(z.toString());
    assert.ok(back.equals(z), `${z.toString()} should round-trip`);
  }
});

test("neg / conjugate / flip", () => {
  const z = new ComplexNumber(3, -2);
  assert.ok(z.neg().equals(new ComplexNumber(-3, 2)));
  assert.ok(z.conjugate().equals(new ComplexNumber(3, 2)));
  assert.ok(z.flip().equals(new ComplexNumber(-2, 3)));
});

test("reciprocal: 1/(a+bi) and zero -> NaCN", () => {
  const z = new ComplexNumber(1, 1);
  const r = z.reciprocal();
  assert.ok(Math.abs(r.value - 0.5) < 1e-12);
  assert.ok(Math.abs(r.iValue + 0.5) < 1e-12);
  assert.ok(ComplexNumber.isNotComplex(new ComplexNumber(0, 0).reciprocal()));
});

test("add / subtract / multiply", () => {
  assert.ok(new ComplexNumber(1, 2).add(new ComplexNumber(3, 4)).equals(new ComplexNumber(4, 6)));
  assert.ok(new ComplexNumber(5, 5).subtract(new ComplexNumber(2, 1)).equals(new ComplexNumber(3, 4)));
  // (1+2i)(3+4i) = 3+4i+6i-8 = -5+10i
  assert.ok(new ComplexNumber(1, 2).multiply(new ComplexNumber(3, 4)).equals(new ComplexNumber(-5, 10)));
});

test("divide and the eight directed infinities (bug fix)", () => {
  // (1+i)/(1-i) = i
  const q = new ComplexNumber(1, 1).divide(new ComplexNumber(1, -1));
  assert.ok(Math.abs(q.value - 0) < 1e-9 && Math.abs(q.iValue - 1) < 1e-9);
  assert.equal(new ComplexNumber(2, 0).divide(new ComplexNumber(0, 0)), ComplexNumber.PositiveInfinity);
  assert.equal(new ComplexNumber(-2, 0).divide(new ComplexNumber(0, 0)), ComplexNumber.NegativeInfinity);
  assert.equal(new ComplexNumber(1, 1).divide(new ComplexNumber(0, 0)), ComplexNumber.InfinityQ1);
  assert.equal(new ComplexNumber(0, 5).divide(new ComplexNumber(0, 0)), ComplexNumber.PositiveInfinityI);
  assert.ok(Number.isNaN(new ComplexNumber(0, 0).divide(new ComplexNumber(0, 0)).value));
});

test("magnitude / angle", () => {
  assert.ok(Math.abs(new ComplexNumber(3, 4).magnitude() - 5) < 1e-12);
  assert.ok(Math.abs(new ComplexNumber(0, 1).angle() - Math.PI / 2) < 1e-12);
});

test("power at zero base is robust (bug fix)", () => {
  assert.ok(new ComplexNumber(0).square().equals(new ComplexNumber(0)), "0^2 = 0");
  assert.ok(new ComplexNumber(0).squareRoot().equals(new ComplexNumber(0)), "sqrt(0) = 0");
  const p = new ComplexNumber(0).power(new ComplexNumber(0));
  assert.ok(Math.abs(p.value - 1) < 1e-9 && Math.abs(p.iValue) < 1e-9, "0^0 = 1 by convention");
});

test("power and roots", () => {
  const nine = new ComplexNumber(3).square();
  assert.ok(Math.abs(nine.value - 9) < 1e-6 && Math.abs(nine.iValue) < 1e-6);
  const i2 = new ComplexNumber(0, 1).square();
  assert.ok(Math.abs(i2.value + 1) < 1e-9 && Math.abs(i2.iValue) < 1e-9, "i^2 = -1");
  const rootNeg1 = new ComplexNumber(-1).squareRoot();
  assert.ok(Math.abs(rootNeg1.value) < 1e-9 && Math.abs(rootNeg1.iValue - 1) < 1e-9, "sqrt(-1) = i");
  const p = new ComplexNumber(2).power(new ComplexNumber(10));
  assert.ok(Math.abs(p.value - 1024) < 1e-6 && Math.abs(p.iValue) < 1e-6);
});

test("logarithm", () => {
  const lnE = ComplexNumber.E.logarithm();
  assert.ok(Math.abs(lnE.value - 1) < 1e-9 && Math.abs(lnE.iValue) < 1e-9, "ln(e) = 1");
  const lnI = new ComplexNumber(0, 1).logarithm();
  assert.ok(Math.abs(lnI.value) < 1e-9 && Math.abs(lnI.iValue - Math.PI / 2) < 1e-9, "ln(i) = i*pi/2");
});

test("euler: e^(i*pi) = -1", () => {
  const r = ComplexNumber.E.power(new ComplexNumber(0, Math.PI));
  assert.ok(Math.abs(r.value + 1) < 1e-5 && Math.abs(r.iValue) < 1e-5);
});

test("trigonometry on reals matches Math", () => {
  const s = new ComplexNumber(0.7).sine();
  assert.ok(Math.abs(s.value - Math.sin(0.7)) < 1e-6 && Math.abs(s.iValue) < 1e-6);
  const c = new ComplexNumber(1.2).cosine();
  assert.ok(Math.abs(c.value - Math.cos(1.2)) < 1e-6 && Math.abs(c.iValue) < 1e-6);
  // sin(i) = i*sinh(1)
  const si = new ComplexNumber(0, 1).sine();
  assert.ok(Math.abs(si.value) < 1e-6 && Math.abs(si.iValue - Math.sinh(1)) < 1e-6);
});

test("inverse trig round-trips", () => {
  const a0 = new ComplexNumber(0).arcSine();
  assert.ok(Math.abs(a0.value) < 1e-9 && Math.abs(a0.iValue) < 1e-9, "arcsin(0) = 0 (bug fix via power(0))");
  const z = new ComplexNumber(0.4, 0.1);
  const back = z.arcSine().sine();
  assert.ok(Math.abs(back.value - 0.4) < 1e-5 && Math.abs(back.iValue - 0.1) < 1e-5);
});

test("toVector returns [re, im]", () => {
  const z = new ComplexNumber(3, 4);
  assert.deepEqual([...z.toVector()], [3, 4]);
});

test("static infinities", () => {
  assert.equal(ComplexNumber.PositiveInfinity.value, Infinity);
  assert.equal(ComplexNumber.NegativeInfinityI.iValue, -Infinity);
  assert.ok(Number.isNaN(ComplexNumber.NaCN.value));
});
