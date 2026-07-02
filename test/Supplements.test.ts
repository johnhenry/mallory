import assert from "node:assert/strict";
import { test } from "node:test";
import { ComplexNumber } from "../src/ComplexNumber.ts";
import { Polygon } from "../src/Polygon.ts";
import { PolynomialRing, parsePolynomial, polynomialToString } from "../src/PolynomialRing.ts";
import { roundTo } from "../src/RealMath.ts";
import { populationStandardDeviation, populationVariance, variance } from "../src/Statistics.ts";
import { Structure } from "../src/Structure.ts";
import { Vector } from "../src/Vector.ts";

const pt = (...xs: number[]) => Vector.fromArray(xs);
const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
const mat = (rows: number[][]) => Vector.fromArray(rows.map((r) => Vector.fromArray(r)));
const polyRing = new PolynomialRing(Structure.realField());

// --- PolynomialRing division & parse ---

test("PolynomialRing.divmod: a = q*b + r", () => {
  const a = [-4, 0, -2, 1]; // x^3 - 2x^2 - 4
  const b = [-3, 1]; // x - 3
  const { quotient, remainder } = polyRing.divmod(a, b);
  // reconstruct q*b + r and compare to a
  const recon = polyRing.add(polyRing.multiply(quotient, b), remainder);
  assert.deepEqual(
    recon.map((c) => roundTo(c, 9)),
    a,
  );
  assert.ok(remainder.length <= b.length - 1 || remainder.every((c) => c === 0));
});

test("PolynomialRing.divide / mod exact division", () => {
  // (x^2 - 1) / (x - 1) = x + 1, remainder 0
  const a = [-1, 0, 1];
  const b = [-1, 1];
  assert.deepEqual(polyRing.divide(a, b), [1, 1]);
  assert.deepEqual(polyRing.mod(a, b), [], "zero polynomial is the empty array");
});

test("PolynomialRing.divmod throws on zero divisor", () => {
  assert.throws(() => polyRing.divmod([1, 2], [0]));
});

test("parsePolynomial inverts polynomialToString", () => {
  const p = [1, -2, 3];
  const round = parsePolynomial(polynomialToString(p));
  assert.deepEqual(round, [1, -2, 3]);
  assert.deepEqual(parsePolynomial("x^2-1"), [-1, 0, 1]);
  assert.deepEqual(parsePolynomial("5"), [5]);
});

// --- Polygon predicates ---

test("Polygon.contains (ray casting)", () => {
  const square = new Polygon(pt(0, 0), pt(4, 0), pt(4, 4), pt(0, 4));
  assert.equal(square.contains(pt(2, 2)), true);
  assert.equal(square.contains(pt(5, 2)), false);
  assert.equal(square.contains(pt(-1, -1)), false);
});

test("Polygon.isConvex", () => {
  const square = new Polygon(pt(0, 0), pt(2, 0), pt(2, 2), pt(0, 2));
  assert.equal(square.isConvex(), true);
  // an arrowhead (concave) quadrilateral
  const arrow = new Polygon(pt(0, 0), pt(4, 2), pt(0, 4), pt(1, 2));
  assert.equal(arrow.isConvex(), false);
});

test("Polygon.isSimple", () => {
  const square = new Polygon(pt(0, 0), pt(2, 0), pt(2, 2), pt(0, 2));
  assert.equal(square.isSimple(), true);
  // a self-intersecting "bowtie"
  const bowtie = new Polygon(pt(0, 0), pt(2, 2), pt(2, 0), pt(0, 2));
  assert.equal(bowtie.isSimple(), false);
});

// --- population variance ---

test("population vs sample variance", () => {
  const data = pt(2, 4, 6);
  assert.equal(variance(data), 4, "sample (N-1)");
  assert.ok(close(populationVariance(data), 8 / 3), "population (N)");
  assert.ok(close(populationStandardDeviation(data), Math.sqrt(8 / 3)));
});

// --- Vector parsing ---

test("Vector.fromXML / fromString round-trip", () => {
  const v = Vector.fromArray([1, 2, 3]);
  assert.deepEqual([...Vector.fromXML(v.toXML())], [1, 2, 3]);
  assert.deepEqual([...Vector.fromString(v.toString())], [1, 2, 3]);
  assert.deepEqual([...Vector.fromString("[a, 2, c]")], ["a", 2, "c"]);
});

// --- Structure presets ---

test("Structure.realField preset", () => {
  const R = Structure.realField();
  assert.equal(R.subtract(5, 3), 2);
  assert.equal(
    R.determinant(
      mat([
        [1, 2],
        [3, 4],
      ]),
    ),
    -2,
  );
});

test("Structure.complexField preset", () => {
  const C = Structure.complexField();
  const z = C.multiply(new ComplexNumber(0, 1), new ComplexNumber(0, 1));
  assert.ok(z.equals(new ComplexNumber(-1, 0)), "i*i = -1");
});

test("Structure.integersModulo preset (GF(7) field)", () => {
  const gf7 = Structure.integersModulo(7);
  assert.equal(gf7.add(5, 4), 2);
  assert.equal(gf7.multiply(3, 5), 1);
  assert.equal(gf7.reciprocal(3), 5);
  // matrix inverse over GF(7)
  const a = mat([
    [2, 3],
    [1, 4],
  ]);
  const prod = gf7.multiplyMatrix(a, gf7.invertMatrix(a));
  assert.equal(gf7.equality((prod[0] as Vector<number>)[0], 1), true);
  assert.equal(gf7.equality((prod[1] as Vector<number>)[1], 1), true);
});

test("Structure.integersModulo: non-invertible element -> NaN", () => {
  const z6 = Structure.integersModulo(6);
  assert.ok(Number.isNaN(z6.reciprocal(2)), "2 has no inverse mod 6");
  assert.equal(z6.reciprocal(5), 5, "5*5 = 25 = 1 mod 6");
});

test("Structure.booleanRing (GF(2))", () => {
  const B = Structure.booleanRing();
  assert.equal(B.add(1, 1), 0, "XOR");
  assert.equal(B.multiply(1, 1), 1, "AND");
  assert.equal(B.add(1, 0), 1);
});
