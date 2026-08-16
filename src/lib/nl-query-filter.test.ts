import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveFilterCommand } from "./nl-query-filter.ts";

test("resolveFilterCommand: 'low-pass at 40 Hz' resolves to lowpass/40, hand-computed", () => {
  assert.deepEqual(resolveFilterCommand("low-pass at 40 Hz"), { filterType: "lowpass", filterCutoffHz: "40" });
});

test("resolveFilterCommand: 'high-pass at 100 Hz' resolves to highpass/100", () => {
  assert.deepEqual(resolveFilterCommand("high-pass at 100 Hz"), { filterType: "highpass", filterCutoffHz: "100" });
});

test("resolveFilterCommand: accepts spacing/casing/'filter' variants -- 'lowpass', 'low pass', 'LOWPASS FILTER', 'highpass filter'", () => {
  assert.deepEqual(resolveFilterCommand("lowpass at 20 hz"), { filterType: "lowpass", filterCutoffHz: "20" });
  assert.deepEqual(resolveFilterCommand("low pass at 20 hz"), { filterType: "lowpass", filterCutoffHz: "20" });
  assert.deepEqual(resolveFilterCommand("LOWPASS FILTER AT 20 HZ"), { filterType: "lowpass", filterCutoffHz: "20" });
  assert.deepEqual(resolveFilterCommand("highpass filter at 20 hz"), { filterType: "highpass", filterCutoffHz: "20" });
});

test("resolveFilterCommand: a fractional cutoff frequency parses correctly", () => {
  assert.deepEqual(resolveFilterCommand("low-pass at 12.5 Hz"), { filterType: "lowpass", filterCutoffHz: "12.5" });
});

test("resolveFilterCommand: bandpass/bandstop phrasings are NOT recognized -- mallory-signal's butter() doesn't offer them (blocked on mallory-plus#90)", () => {
  assert.equal(resolveFilterCommand("band-pass at 40 Hz"), null);
  assert.equal(resolveFilterCommand("bandstop at 40 Hz"), null);
});

test("resolveFilterCommand: a plain math expression does not match", () => {
  assert.equal(resolveFilterCommand("sin(2*pi*40*t)"), null);
  assert.equal(resolveFilterCommand("derivative of sin(t)"), null);
});

test("resolveFilterCommand: missing the frequency or unit does not match", () => {
  assert.equal(resolveFilterCommand("low-pass filter"), null);
  assert.equal(resolveFilterCommand("low-pass at 40"), null);
});

test("resolveFilterCommand: missing the 'at' keyword does not match", () => {
  assert.equal(resolveFilterCommand("low-pass 40 hz"), null);
});
