import assert from "node:assert/strict";
import { test } from "node:test";
import { Decimal } from "../src/Decimal.ts";
import { Structure } from "../src/Structure.ts";

test("Decimal.from parses integers, decimals, negatives, and scientific notation", () => {
  assert.equal(Decimal.from("123").toString(), "123");
  assert.equal(Decimal.from("3.14159").toString(), "3.14159");
  assert.equal(Decimal.from("-0.5").toString(), "-0.5");
  assert.equal(Decimal.from("1.5e3").toString(), "1500");
  assert.equal(Decimal.from("1.5e-3").toString(), "0.0015");
  assert.equal(Decimal.from(42).toString(), "42");
  assert.equal(Decimal.from(0.1).toString(), "0.1");
  assert.equal(Decimal.from(10n).toString(), "10");
  assert.throws(() => Decimal.from("not a number"));
});

test("Decimal exact addition avoids float drift (0.1 + 0.2)", () => {
  const sum = Decimal.from("0.1").add(Decimal.from("0.2"));
  assert.equal(sum.toString(), "0.3");
  assert.notEqual(0.1 + 0.2, 0.3, "sanity: the float version really does drift");
});

test("Decimal add/subtract/multiply are exact across differing exponents", () => {
  assert.equal(Decimal.from("1.5").add(Decimal.from("2.25")).toString(), "3.75");
  assert.equal(Decimal.from("5").subtract(Decimal.from("1.25")).toString(), "3.75");
  assert.equal(Decimal.from("2.5").multiply(Decimal.from("4")).toString(), "10");
  assert.equal(Decimal.from("1.1").multiply(Decimal.from("1.1")).toString(), "1.21");
});

test("Decimal division rounds to the requested precision", () => {
  const third = Decimal.from(1).divide(Decimal.from(3), 10);
  assert.equal(third.toString(), "0.3333333333");
  assert.equal(Decimal.from("10").divide(Decimal.from("4")).toString(), "2.5");
  assert.throws(() => Decimal.from(1).divide(Decimal.from(0)));
});

test("Decimal negate/abs/equals/compare", () => {
  const a = Decimal.from("3.14");
  const b = Decimal.from("3.140");
  assert.ok(a.equals(b), "equality aligns exponents rather than requiring identical digits");
  assert.equal(a.negate().toString(), "-3.14");
  assert.equal(a.negate().abs().toString(), "3.14");
  assert.ok(Decimal.from("1").lessThan(Decimal.from("2")));
  assert.equal(Decimal.from("2").compare(Decimal.from("2")), 0);
});

test("Decimal.toNumber", () => {
  assert.equal(Decimal.from("3.5").toNumber(), 3.5);
  assert.equal(Decimal.from("0").toString(), "0");
});

test("Structure.decimalField does linear algebra over exact Decimals", () => {
  const field = Structure.decimalField();
  const a = Decimal.from("1.5");
  const b = Decimal.from("2.5");
  assert.ok(field.add(a, b).equals(Decimal.from("4")));
  assert.ok(field.multiply(a, b).equals(Decimal.from("3.75")));
  assert.ok(field.subtract(b, a).equals(Decimal.from("1")));
  assert.ok(field.reciprocal(Decimal.from("4")).equals(Decimal.from(1).divide(Decimal.from(4))));
});
