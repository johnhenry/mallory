import assert from "node:assert/strict";
import { test } from "node:test";
import { DualNumber } from "../src/DualNumber.ts";
import { Interval } from "../src/Interval.ts";
import { Quaternion } from "../src/Quaternion.ts";
import { Rational } from "../src/Rational.ts";
import { Structure } from "../src/Structure.ts";
import { Vector } from "../src/Vector.ts";

const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

// --- Rational ---

test("Rational normalizes to lowest terms with positive denominator", () => {
  const r = new Rational(4, -8);
  assert.equal(r.numerator, -1n);
  assert.equal(r.denominator, 2n);
  assert.equal(r.toString(), "-1/2");
});

test("Rational exact arithmetic (1/3 + 1/6 = 1/2)", () => {
  const sum = new Rational(1, 3).add(new Rational(1, 6));
  assert.ok(sum.equals(new Rational(1, 2)));
  assert.ok(new Rational(2, 3).multiply(new Rational(3, 4)).equals(new Rational(1, 2)));
  assert.ok(new Rational(1, 2).divide(new Rational(1, 4)).equals(new Rational(2, 1)));
  assert.ok(new Rational(2, 3).pow(-2).equals(new Rational(9, 4)));
});

test("Rational compare and fromNumber", () => {
  assert.ok(new Rational(1, 3).lessThan(new Rational(1, 2)));
  assert.ok(Rational.fromNumber(0.5).equals(new Rational(1, 2)));
  assert.ok(close(Rational.fromNumber(Math.PI, 1000).toNumber(), Math.PI, 1e-3));
});

// --- Quaternion ---

test("Quaternion Hamilton product (i*j = k)", () => {
  const i = new Quaternion(0, 1, 0, 0);
  const j = new Quaternion(0, 0, 1, 0);
  assert.ok(i.multiply(j).equals(new Quaternion(0, 0, 0, 1)));
  assert.ok(j.multiply(i).equals(new Quaternion(0, 0, 0, -1)), "non-commutative");
});

test("Quaternion rotation by 90° about z maps x -> y", () => {
  const q = Quaternion.fromAxisAngle([0, 0, 1], Math.PI / 2);
  const [x, y, z] = q.rotateVector([1, 0, 0]);
  assert.ok(close(x, 0, 1e-9) && close(y, 1, 1e-9) && close(z, 0, 1e-9));
});

test("Quaternion inverse and slerp endpoints", () => {
  const q = new Quaternion(1, 2, 3, 4);
  const prod = q.multiply(q.inverse());
  assert.ok(close(prod.w, 1, 1e-9) && close(prod.x, 0, 1e-9));
  const a = Quaternion.Identity;
  const b = Quaternion.fromAxisAngle([0, 0, 1], Math.PI / 2);
  assert.ok(Quaternion.slerp(a, b, 0).normalize().equals(a));
});

// --- DualNumber / autodiff ---

test("DualNumber exact derivatives", () => {
  // d/dx x^3 at 2 = 12
  assert.ok(
    close(
      DualNumber.derivative((x) => x.pow(3), 2),
      12,
    ),
  );
  // d/dx sin(x^2) at 1 = 2cos(1)
  const f = (x: DualNumber) => DualNumber.sin(x.multiply(x));
  assert.ok(close(DualNumber.derivative(f, 1), 2 * Math.cos(1)));
  // d/dx exp(x)/x at 1 = 0 (since (e·1 - e)/1)
  const g = (x: DualNumber) => DualNumber.exp(x).divide(x);
  assert.ok(close(DualNumber.derivative(g, 1), 0, 1e-9));
});

test("DualNumber gradient", () => {
  // f = x^2 + x*y ; grad at (3,4) = (2x+y, x) = (10, 3)
  const f = (v: DualNumber[]) => v[0].multiply(v[0]).add(v[0].multiply(v[1]));
  const grad = DualNumber.gradient(f, [3, 4]);
  assert.ok(close(grad[0], 10) && close(grad[1], 3));
});

// --- Interval ---

test("Interval arithmetic bounds results", () => {
  const a = new Interval(1, 2);
  const b = new Interval(3, 4);
  assert.ok(a.add(b).equals(new Interval(4, 6)));
  assert.ok(a.subtract(b).equals(new Interval(-3, -1)));
  assert.ok(a.multiply(b).equals(new Interval(3, 8)));
  assert.ok(new Interval(-2, 3).pow(2).equals(new Interval(0, 9)), "even power straddling zero");
});

test("Interval intersect / hull / contains", () => {
  const a = new Interval(0, 5);
  const b = new Interval(3, 8);
  assert.ok(a.intersect(b)?.equals(new Interval(3, 5)));
  assert.ok(a.hull(b).equals(new Interval(0, 8)));
  assert.equal(a.intersect(new Interval(10, 11)), null);
  assert.ok(a.contains(2.5));
});

test("Interval sin bounds include critical points", () => {
  // [0, π] contains π/2 where sin=1
  const s = new Interval(0, Math.PI).sin();
  assert.ok(close(s.hi, 1) && close(s.lo, 0, 1e-12));
  assert.ok(new Interval(0, 7).sin().equals(new Interval(-1, 1)), "spans full period");
});

// --- Structure presets ---

test("Structure.rationalField supports exact linear algebra", () => {
  const Q = Structure.rationalField();
  const r = (n: number, d: number) => new Rational(n, d);
  assert.ok(Q.equality(Q.add(r(1, 3), r(1, 6)), r(1, 2)));
  // exact determinant of [[1/2, 1/3],[1/4, 1/5]] = 1/10 - 1/12 = 1/60
  const m = Vector.fromArray([Vector.fromArray([r(1, 2), r(1, 3)]), Vector.fromArray([r(1, 4), r(1, 5)])]);
  assert.ok(Q.determinant(m).equals(r(1, 60)), "exact rational determinant");
});

test("Structure.quaternionRing and dualNumbers presets", () => {
  const H = Structure.quaternionRing();
  const i = new Quaternion(0, 1, 0, 0);
  assert.ok(H.equality(H.multiply(i, i), new Quaternion(-1, 0, 0, 0)), "i^2 = -1");
  const D = Structure.dualNumbers();
  const two = new DualNumber(2, 1);
  assert.ok(H !== null && D.equality(D.multiply(two, two), new DualNumber(4, 4)));
});
