import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeMatrixState } from "./matrix-state.ts";
import { resolveMatrixNavigationCommand } from "./nl-query-matrix.ts";

test("resolveMatrixNavigationCommand: 'eigenvalues of [[...]]' resolves to the matrix tab with the parsed matrix prefilled, hand-computed", () => {
  const command = resolveMatrixNavigationCommand("eigenvalues of [[1,2],[3,4]]");
  assert.ok(command);
  assert.equal(command.to, "/data");
  assert.deepEqual(command.search, { tab: "matrix" });
  const decoded = decodeMatrixState(command.hash);
  assert.ok(decoded);
  assert.equal(decoded.matrixText, "1, 2\n3, 4");
});

test("resolveMatrixNavigationCommand: recognizes every listed verb phrasing ('invert', 'inverse of', 'determinant of', 'det of', 'eigenvalue of' singular)", () => {
  const verbs = ["invert", "inverse of", "determinant of", "det of", "eigenvalue of", "eigenvalues of"];
  for (const verb of verbs) {
    const command = resolveMatrixNavigationCommand(`${verb} [[5,0],[0,5]]`);
    assert.ok(command, `expected "${verb}" to match`);
    assert.equal(decodeMatrixState(command.hash)?.matrixText, "5, 0\n0, 5");
  }
});

test("resolveMatrixNavigationCommand: a single-row matrix (1xN) round-trips correctly", () => {
  const command = resolveMatrixNavigationCommand("determinant of [[7]]");
  assert.equal(decodeMatrixState(command?.hash ?? "")?.matrixText, "7");
});

test("resolveMatrixNavigationCommand: preserves the default polyCoeffs (only matrixText is set by this command)", () => {
  const command = resolveMatrixNavigationCommand("invert [[1,0],[0,1]]");
  const decoded = decodeMatrixState(command?.hash ?? "");
  assert.equal(decoded?.polyCoeffs, "-6, 11, -6");
});

test("resolveMatrixNavigationCommand: input with no recognized verb returns null", () => {
  assert.equal(resolveMatrixNavigationCommand("go to statistics"), null);
  assert.equal(resolveMatrixNavigationCommand("derivative of x^2"), null);
  assert.equal(resolveMatrixNavigationCommand("[[1,2],[3,4]]"), null); // no verb at all
});

test("resolveMatrixNavigationCommand: a ragged (non-rectangular) matrix literal is rejected", () => {
  assert.equal(resolveMatrixNavigationCommand("invert [[1,2],[3,4,5]]"), null);
});

test("resolveMatrixNavigationCommand: a non-numeric entry is rejected", () => {
  assert.equal(resolveMatrixNavigationCommand("invert [[1,\"x\"],[3,4]]"), null);
});

test("resolveMatrixNavigationCommand: malformed JSON is rejected rather than throwing", () => {
  assert.equal(resolveMatrixNavigationCommand("invert [[1,2],[3,4]"), null);
});

test("resolveMatrixNavigationCommand: an empty matrix literal is rejected", () => {
  assert.equal(resolveMatrixNavigationCommand("invert []"), null);
});

test("resolveMatrixNavigationCommand: 'this matrix' (no literal) does not match -- intentionally out of scope, see module doc", () => {
  assert.equal(resolveMatrixNavigationCommand("invert this matrix"), null);
});
