import assert from "node:assert/strict";
import { test } from "node:test";
import * as fc from "fast-check";
import { ComplexNumber } from "../src/ComplexNumber.ts";
import { Decimal } from "../src/Decimal.ts";
import { NumberTheory } from "../src/NumberTheory.ts";
import { PolynomialRing } from "../src/PolynomialRing.ts";
import { Rational } from "../src/Rational.ts";
import { Structure } from "../src/Structure.ts";

// --- Structure axioms, checked generically across several concrete fields ---

interface FieldCase<T> {
  name: string;
  structure: Structure<T>;
  arb: fc.Arbitrary<T>;
  nonZeroArb: fc.Arbitrary<T>;
  close: (a: T, b: T) => boolean;
}

const realClose = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const complexClose = (a: ComplexNumber, b: ComplexNumber) =>
  Math.abs(a.value - b.value) < 1e-6 && Math.abs(a.iValue - b.iValue) < 1e-6;
const decimalClose = (a: Decimal, b: Decimal) =>
  Math.abs(Number(a.digits) * 10 ** a.exponent - Number(b.digits) * 10 ** b.exponent) < 1e-6;

const smallReal = fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true });
// Excludes values too close to zero: their reciprocal over/underflows and breaks
// the `a * (1/a) = 1` check for reasons unrelated to the field axiom being tested.
const nonZeroReal = smallReal.filter((x) => Math.abs(x) > 1e-6);

const cases: FieldCase<unknown>[] = [
  {
    name: "realField",
    structure: Structure.realField(),
    arb: smallReal,
    nonZeroArb: nonZeroReal,
    close: realClose,
  } as FieldCase<number>,
  {
    name: "complexField",
    structure: Structure.complexField(),
    arb: fc.tuple(smallReal, smallReal).map(([re, im]) => new ComplexNumber(re, im)),
    nonZeroArb: fc.tuple(nonZeroReal, nonZeroReal).map(([re, im]) => new ComplexNumber(re, im)),
    close: complexClose,
  } as FieldCase<ComplexNumber>,
  {
    name: "integersModulo(7)",
    structure: Structure.integersModulo(7),
    arb: fc.integer({ min: -50, max: 50 }).map((n) => Structure.integersModulo(7).wrap(n)),
    nonZeroArb: fc.integer({ min: 1, max: 6 }).map((n) => Structure.integersModulo(7).wrap(n)),
    close: (a: number, b: number) => a === b,
  } as FieldCase<number>,
  {
    name: "decimalField",
    structure: Structure.decimalField(),
    arb: fc.integer({ min: -1000, max: 1000 }).map((n) => Decimal.from(n)),
    nonZeroArb: fc
      .integer({ min: -1000, max: 1000 })
      .filter((n) => n !== 0)
      .map((n) => Decimal.from(n)),
    close: decimalClose,
  } as FieldCase<Decimal>,
];

for (const { name, structure, arb, nonZeroArb, close } of cases) {
  test(`Structure axioms hold for ${name}`, () => {
    fc.assert(
      fc.property(arb, arb, arb, (a, b, c) => {
        assert.ok(close(structure.add(a, b), structure.add(b, a)), "add commutes");
        assert.ok(
          close(structure.add(structure.add(a, b), c), structure.add(a, structure.add(b, c))),
          "add associates",
        );
        assert.ok(close(structure.add(a, structure.zero), a), "additive identity");
        assert.ok(close(structure.add(a, structure.negative(a)), structure.zero), "additive inverse");
        assert.ok(
          close(structure.multiply(structure.multiply(a, b), c), structure.multiply(a, structure.multiply(b, c))),
          "multiply associates",
        );
        assert.ok(
          close(
            structure.multiply(a, structure.add(b, c)),
            structure.add(structure.multiply(a, b), structure.multiply(a, c)),
          ),
          "left distributivity",
        );
        assert.ok(close(structure.multiply(a, structure.one), a), "multiplicative identity");
      }),
      { numRuns: 50 },
    );
  });

  test(`Structure multiplicative inverse holds for ${name}`, () => {
    fc.assert(
      fc.property(nonZeroArb, (a) => {
        assert.ok(close(structure.multiply(a, structure.reciprocal(a)), structure.one), "a * (1/a) = 1");
      }),
      { numRuns: 50 },
    );
  });
}

// --- PolynomialRing: divmod reconstructs the dividend, gcd divides both ---
// Rational coefficients keep this exact (no floating-point tolerance needed).

const ring = new PolynomialRing(Structure.rationalField());
const coeff = fc.integer({ min: -9, max: 9 }).map((n) => Rational.from(n));
const nonZeroPoly = fc.array(coeff, { minLength: 1, maxLength: 4 }).filter((p) => !p[p.length - 1]?.isZero());
const anyPoly = fc.array(coeff, { minLength: 0, maxLength: 6 });

test("PolynomialRing.divmod reconstructs the dividend: a = q*b + r", () => {
  fc.assert(
    fc.property(anyPoly, nonZeroPoly, (a, b) => {
      const { quotient, remainder } = ring.divmod(a, b);
      const recon = ring.add(ring.multiply(quotient, b), remainder);
      assert.ok(ring.equal(recon, a));
      assert.ok(ring.degree(remainder) < ring.degree(b));
    }),
    { numRuns: 100 },
  );
});

test("PolynomialRing.gcd(a, b) divides both a and b", () => {
  fc.assert(
    fc.property(nonZeroPoly, nonZeroPoly, (a, b) => {
      const g = ring.gcd(a, b);
      assert.ok(ring.equal(ring.mod(a, g), []), "gcd divides a");
      assert.ok(ring.equal(ring.mod(b, g), []), "gcd divides b");
    }),
    { numRuns: 100 },
  );
});

// --- Rational: round-trips through toString, arithmetic laws ---

const rational = fc
  .tuple(fc.integer({ min: -1000, max: 1000 }), fc.integer({ min: 1, max: 1000 }))
  .map(([n, d]) => new Rational(n, d));
const nonZeroRational = rational.filter((r) => !r.isZero());

test("Rational: constructor always reduces to lowest terms with a positive denominator", () => {
  fc.assert(
    fc.property(fc.integer({ min: -1000, max: 1000 }), fc.integer({ min: 1, max: 1000 }), (n, d) => {
      const r = new Rational(n, d);
      assert.ok(r.denominator > 0n);
      assert.equal(NumberTheory.gcd(r.numerator, r.denominator), 1n);
    }),
    { numRuns: 100 },
  );
});

test("Rational: toString round-trips through manual reconstruction", () => {
  fc.assert(
    fc.property(rational, (r) => {
      const s = r.toString();
      const [numStr, denStr] = s.includes("/") ? s.split("/") : [s, "1"];
      const back = new Rational(BigInt(numStr as string), BigInt(denStr as string));
      assert.ok(back.equals(r));
    }),
    { numRuns: 100 },
  );
});

test("Rational: arithmetic laws (commutativity, associativity, distributivity, inverses)", () => {
  fc.assert(
    fc.property(rational, rational, rational, (a, b, c) => {
      assert.ok(a.add(b).equals(b.add(a)), "add commutes");
      assert.ok(
        a
          .add(b)
          .add(c)
          .equals(a.add(b.add(c))),
        "add associates",
      );
      assert.ok(a.subtract(a).equals(Rational.Zero), "a - a = 0");
      assert.ok(a.multiply(b.add(c)).equals(a.multiply(b).add(a.multiply(c))), "distributivity");
    }),
    { numRuns: 100 },
  );
  fc.assert(
    fc.property(nonZeroRational, (a) => {
      assert.ok(a.divide(a).equals(Rational.One), "a / a = 1");
    }),
    { numRuns: 100 },
  );
});

// --- NumberTheory: extended-GCD Bezout identity, CRT reconstruction ---

test("NumberTheory.extendedGcd satisfies the Bezout identity a*x + b*y = gcd(a, b)", () => {
  fc.assert(
    fc.property(fc.integer({ min: -1000, max: 1000 }), fc.integer({ min: -1000, max: 1000 }), (a, b) => {
      const { g, x, y } = NumberTheory.extendedGcd(a, b);
      assert.equal(BigInt(a) * x + BigInt(b) * y, g);
      assert.equal(g, NumberTheory.gcd(a, b));
    }),
    { numRuns: 200 },
  );
});

// Fixed, pairwise-coprime moduli — keeps the property well-defined without
// having to search for coprime tuples.
const CRT_MODULI = [3n, 5n, 7n, 11n];

test("NumberTheory.crt reconstructs x congruent to each remainder mod its modulus", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 2 }),
      fc.integer({ min: 0, max: 4 }),
      fc.integer({ min: 0, max: 6 }),
      fc.integer({ min: 0, max: 10 }),
      (r0, r1, r2, r3) => {
        const remainders = [r0, r1, r2, r3];
        const result = NumberTheory.crt(remainders, CRT_MODULI);
        assert.ok(result !== null);
        const { x, modulus } = result as { x: bigint; modulus: bigint };
        assert.equal(
          modulus,
          CRT_MODULI.reduce((acc, m) => acc * m, 1n),
        );
        for (let i = 0; i < CRT_MODULI.length; i++) {
          assert.equal(NumberTheory.mod(x, CRT_MODULI[i] as bigint), BigInt(remainders[i] as number));
        }
      },
    ),
    { numRuns: 100 },
  );
});
