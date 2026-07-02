import assert from "node:assert/strict";
import { test } from "node:test";
import type { ComplexNumber } from "../src/ComplexNumber.ts";
import { Environment } from "../src/Environment.ts";
import { Expression } from "../src/Expression.ts";
import { StringEvaluator } from "../src/StringEvaluator.ts";
import { Vector } from "../src/Vector.ts";

const val = (x: unknown) => (x as ComplexNumber).value;
const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

test("Environment: mutable and immutable bindings", () => {
  const env = new Environment("pi", 3.14);
  assert.equal(env.existImmutableKey("pi"), true);
  assert.equal(env.retrieve("pi"), 3.14);
  assert.equal(env.assign("pi", 3), false, "cannot overwrite immutable");
  env.assign("x", 5);
  assert.equal(env.retrieve("x"), 5);
  assert.equal(env.remove("x"), true);
  assert.equal(env.retrieve("unknown"), "unknown", "unknown key resolves to itself");
});

test("Environment: assigning undefined removes; clone is independent", () => {
  const env = new Environment();
  env.assign("a", 1);
  env.assign("a", undefined);
  assert.equal(env.existKey("a"), false);
  env.assign("b", 2);
  const c = env.clone();
  c.assign("b", 99);
  assert.equal(env.retrieve("b"), 2);
});

test("evaluate: numeric literals and complex numbers", () => {
  const env = StringEvaluator.mathEnvironment();
  assert.equal(val(StringEvaluator.evaluate("42", env)), 42);
  assert.equal((StringEvaluator.evaluate("3+2*i", env) as ComplexNumber).iValue, 2);
});

test("evaluate: precedence (+ looser than *)", () => {
  const env = StringEvaluator.mathEnvironment();
  assert.equal(val(StringEvaluator.evaluate("3+4*2", env)), 11);
  assert.equal(val(StringEvaluator.evaluate("2*3+4", env)), 10);
});

test("evaluate: left-associative subtraction and division (bug fix)", () => {
  const env = StringEvaluator.mathEnvironment();
  assert.equal(val(StringEvaluator.evaluate("10-2-3", env)), 5); // was 11 (right-assoc)
  assert.equal(val(StringEvaluator.evaluate("8/4/2", env)), 1); // was 4 (right-assoc)
});

test("evaluate: power is right-associative", () => {
  const env = StringEvaluator.mathEnvironment();
  assert.ok(close(val(StringEvaluator.evaluate("2^3^2", env)), 512));
  assert.ok(close(val(StringEvaluator.evaluate("2^10", env)), 1024));
});

test("evaluate: parentheses override precedence", () => {
  const env = StringEvaluator.mathEnvironment();
  assert.equal(val(StringEvaluator.evaluate("(3+4)*2", env)), 14);
  assert.ok(close(val(StringEvaluator.evaluate("((2+3))", env)), 5));
});

test("evaluate: functions and constants", () => {
  const env = StringEvaluator.mathEnvironment();
  assert.ok(close(val(StringEvaluator.evaluate("sin(pi/2)", env)), 1));
  assert.ok(close(val(StringEvaluator.evaluate("cos(0)", env)), 1));
  assert.ok(close((StringEvaluator.evaluate("sqrt(-1)", env) as ComplexNumber).iValue, 1));
  assert.ok(close(val(StringEvaluator.evaluate("abs(3+4*i)", env)), 5));
});

test("evaluate: nested function inside arithmetic (the AS3 known issue)", () => {
  const env = StringEvaluator.mathEnvironment();
  // sin(-12+4) = sin(-8)
  assert.ok(close(val(StringEvaluator.evaluate("sin(-12+4)", env)), Math.sin(-8)));
});

test("evaluate: modulus yields a non-negative result", () => {
  const env = StringEvaluator.mathEnvironment();
  assert.equal(val(StringEvaluator.evaluate("-1%4", env)), 3);
});

test("evaluate: unbalanced parentheses report an error", () => {
  const env = StringEvaluator.mathEnvironment();
  assert.ok(StringEvaluator.evaluate("(3+4", env) instanceof Error);
  assert.ok(StringEvaluator.evaluate("3+4)", env) instanceof Error);
});

test("evaluate: vectors", () => {
  const env = StringEvaluator.mathEnvironment();
  const v = StringEvaluator.evaluate("[1,2,3]", env) as Vector<ComplexNumber>;
  assert.ok(v instanceof Vector);
  assert.deepEqual(
    [...v].map((c) => c.value),
    [1, 2, 3],
  );
});

test("evaluate: unbound function passes through symbolically (bug fix)", () => {
  const env = StringEvaluator.mathEnvironment();
  assert.equal(StringEvaluator.evaluate("foo(3)", env), "foo(3)");
});

test("Expression: evaluate a formula with variables", () => {
  const env = StringEvaluator.mathEnvironment();
  const f = new Expression("x^2+1", ["x"]);
  assert.ok(close(val(f.evaluate([3], env)), 10));
  assert.ok(close(val(f.evaluate([5], env)), 26));
  assert.equal(f.toString(), "function(x)=x^2+1");
});

test("Expression: multivariate", () => {
  const env = StringEvaluator.mathEnvironment();
  const f = new Expression("x*y+1", ["x", "y"]);
  assert.ok(close(val(f.evaluate([3, 4], env)), 13));
});
