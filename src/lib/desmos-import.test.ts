import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDesmosExpressionList, parseDesmosLine } from "./desmos-import.ts";

test("parseDesmosLine: a bare 'y=' function strips the prefix and parses the RHS, hand-verified", () => {
  const result = parseDesmosLine("y=\\sin\\left(x\\right)");
  assert.deepEqual(result, { source: "sin(x)" });
});

test("parseDesmosLine: a named-function definition 'f(x)=' strips the prefix the same way", () => {
  const result = parseDesmosLine("f\\left(x\\right)=x^{2}+1");
  assert.deepEqual(result, { source: "x^2 + 1" });
});

test("parseDesmosLine: explicit \\cdot multiplication round-trips", () => {
  const result = parseDesmosLine("y=2\\cdot x+1");
  assert.deepEqual(result, { source: "2*x + 1" });
});

test("parseDesmosLine: a bare expression with no leading assignment parses as-is", () => {
  const result = parseDesmosLine("\\sqrt{x}");
  assert.deepEqual(result, { source: "sqrt(x)" });
});

test("parseDesmosLine: an empty or whitespace-only line reports an error, not a crash", () => {
  assert.deepEqual(parseDesmosLine(""), { error: "Empty line." });
  assert.deepEqual(parseDesmosLine("   "), { error: "Empty line." });
});

test("parseDesmosLine: unparseable LaTeX reports the underlying parse error rather than throwing", () => {
  const result = parseDesmosLine("y=x^{2}+3x-1");
  assert.ok("error" in result, `expected an error for implicit multiplication, got: ${JSON.stringify(result)}`);
});

test("parseDesmosExpressionList: a mixed multi-line paste reports per-line success/failure independently, one bad line doesn't fail the whole paste", () => {
  const rows = parseDesmosExpressionList("y=\\sin\\left(x\\right)\n\ny=x^{2}+3x-1\ny=\\cos\\left(x\\right)");
  assert.equal(rows.length, 3, "the blank line is skipped, not reported");
  assert.deepEqual(rows[0], { line: "y=\\sin\\left(x\\right)", source: "sin(x)" });
  assert.ok(rows[1]!.error, "the implicit-multiplication line should report an error");
  assert.equal(rows[1]!.line, "y=x^{2}+3x-1");
  assert.deepEqual(rows[2], { line: "y=\\cos\\left(x\\right)", source: "cos(x)" });
});

test("parseDesmosExpressionList: an all-blank paste returns an empty array", () => {
  assert.deepEqual(parseDesmosExpressionList("\n\n   \n"), []);
});
