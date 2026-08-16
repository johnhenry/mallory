import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeDiscreteState } from "./discrete-state.ts";
import { resolveDiscreteNavigationCommand } from "./nl-query-discrete.ts";

test("resolveDiscreteNavigationCommand: 'cayley table of Z/6' resolves to the discrete tab with a cyclic group of order 6, hand-computed", () => {
  const command = resolveDiscreteNavigationCommand("cayley table of Z/6");
  assert.ok(command);
  assert.equal(command.to, "/data");
  assert.deepEqual(command.search, { tab: "discrete" });
  const decoded = decodeDiscreteState(command.hash);
  assert.equal(decoded?.groupKind, "cyclic");
  assert.equal(decoded?.groupN, "6");
});

test("resolveDiscreteNavigationCommand: 'Z_6' (underscore) and case-insensitivity are both accepted", () => {
  assert.equal(decodeDiscreteState(resolveDiscreteNavigationCommand("cayley table of Z_6")?.hash ?? "")?.groupN, "6");
  assert.equal(decodeDiscreteState(resolveDiscreteNavigationCommand("CAYLEY TABLE OF z/6")?.hash ?? "")?.groupKind, "cyclic");
});

test("resolveDiscreteNavigationCommand: 'cayley table of S/4' resolves to the symmetric group of degree 4", () => {
  const command = resolveDiscreteNavigationCommand("cayley table of S/4");
  const decoded = decodeDiscreteState(command?.hash ?? "");
  assert.equal(decoded?.groupKind, "symmetric");
  assert.equal(decoded?.groupN, "4");
});

test("resolveDiscreteNavigationCommand: 'factor 3599' resolves to factorizeN=3599, every other field left at default", () => {
  const command = resolveDiscreteNavigationCommand("factor 3599");
  const decoded = decodeDiscreteState(command?.hash ?? "");
  assert.equal(decoded?.factorizeN, "3599");
  assert.equal(decoded?.groupKind, "cyclic");
  assert.equal(decoded?.groupN, "6");
  assert.equal(decoded?.gcdA, "270");
});

test("resolveDiscreteNavigationCommand: 'factorize 360' (longer verb form) is also recognized", () => {
  assert.equal(decodeDiscreteState(resolveDiscreteNavigationCommand("factorize 360")?.hash ?? "")?.factorizeN, "360");
});

test("resolveDiscreteNavigationCommand: input with no recognized phrasing returns null", () => {
  assert.equal(resolveDiscreteNavigationCommand("go to statistics"), null);
  assert.equal(resolveDiscreteNavigationCommand("derivative of x^2"), null);
  assert.equal(resolveDiscreteNavigationCommand("eigenvalues of [[1,2],[3,4]]"), null);
});

test("resolveDiscreteNavigationCommand: 'factor' with no number, or a non-numeric group order, does not match", () => {
  assert.equal(resolveDiscreteNavigationCommand("factor"), null);
  assert.equal(resolveDiscreteNavigationCommand("cayley table of Z/n"), null);
});

test("resolveDiscreteNavigationCommand: 'factor' followed by a non-numeric argument does not match (only a bare integer is accepted)", () => {
  assert.equal(resolveDiscreteNavigationCommand("factor abc"), null);
});
