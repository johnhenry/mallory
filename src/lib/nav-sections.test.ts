import assert from "node:assert/strict";
import { test } from "node:test";
import { NAV_SECTIONS, resolveNavigationCommand, SECTION_PATHS } from "./nav-sections.ts";

test("SECTION_PATHS: every NAV_SECTIONS path plus /demos, in order", () => {
  assert.deepEqual(SECTION_PATHS, [...NAV_SECTIONS.map((s) => s.to), "/demos"]);
});

test("resolveNavigationCommand: exact and near-exact label matches for each verb phrasing", () => {
  assert.equal(resolveNavigationCommand("go to graphing"), "/graphing");
  assert.equal(resolveNavigationCommand("open geometry"), "/geo");
  assert.equal(resolveNavigationCommand("show me the notebook"), "/notes");
  assert.equal(resolveNavigationCommand("navigate to calculus"), "/calculus");
  assert.equal(resolveNavigationCommand("take me to the gallery"), "/gallery");
});

test("resolveNavigationCommand: is case-insensitive and tolerant of trailing filler words", () => {
  assert.equal(resolveNavigationCommand("GO TO GRAPHING"), "/graphing");
  assert.equal(resolveNavigationCommand("go to the graphing panel"), "/graphing");
  assert.equal(resolveNavigationCommand("open the graphing view"), "/graphing");
});

test('resolveNavigationCommand: "&" in a label is treated as "and", so a typed phrase without it still matches', () => {
  assert.equal(resolveNavigationCommand("go to 3d and surfaces"), "/3d");
  assert.equal(resolveNavigationCommand("go to 3d"), "/3d");
  assert.equal(resolveNavigationCommand("open data and algebra"), "/data");
  assert.equal(resolveNavigationCommand("open data"), "/data");
});

test("resolveNavigationCommand: falls through to null on an unrecognized verb, an unmatched section, or a plain expression", () => {
  assert.equal(resolveNavigationCommand("derivative of x^2"), null);
  assert.equal(resolveNavigationCommand("set a to 3"), null);
  assert.equal(resolveNavigationCommand("go to narnia"), null);
  assert.equal(resolveNavigationCommand(""), null);
  assert.equal(resolveNavigationCommand("go to"), null);
});
