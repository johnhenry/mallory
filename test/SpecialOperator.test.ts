import assert from "node:assert/strict";
import { test } from "node:test";
import { SpecialOperator } from "../src/SpecialOperator.ts";

test("stores rep and funct", () => {
  const op = new SpecialOperator("@", "at");
  assert.equal(op.rep, "@");
  assert.equal(op.funct, "at");
  assert.equal(op.toString(), "Operator: @");
});

test("predefined operators", () => {
  assert.equal(SpecialOperator.Plus.rep, "+");
  assert.equal(SpecialOperator.Plus.funct, "add");
  assert.equal(SpecialOperator.Power.rep, "^");
  assert.equal(SpecialOperator.Elipses.rep, "...");
  assert.equal(SpecialOperator.Elipses.funct, null);
  assert.equal(SpecialOperator.System.funct, null);
});
