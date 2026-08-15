import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_SIGNAL_STATE,
  decodeSignalState,
  encodeSignalState,
  isSignalStateV1,
  isSignalStateV2,
  type SignalStateV1,
} from "./signal-state.ts";

test("encodeSignalState/decodeSignalState: round-trips the default state", () => {
  const encoded = encodeSignalState(DEFAULT_SIGNAL_STATE);
  const decoded = decodeSignalState(encoded);
  assert.deepEqual(decoded, DEFAULT_SIGNAL_STATE);
});

test("decodeSignalState: returns null for garbage input rather than throwing", () => {
  assert.equal(decodeSignalState("not-valid-base64url!!"), null);
});

test("decodeSignalState: upgrades a v1 payload to v2, defaulting the spectrogram fields", () => {
  const v1: SignalStateV1 = { v: 1, exprText: "sin(2*pi*3*t)", sampleRate: "128", duration: "2" };
  const encoded = Buffer.from(JSON.stringify(v1)).toString("base64url");
  const decoded = decodeSignalState(encoded);
  assert.ok(decoded);
  assert.equal(decoded.v, 2);
  assert.equal(decoded.exprText, "sin(2*pi*3*t)");
  assert.equal(decoded.sampleRate, "128");
  assert.equal(decoded.nperseg, DEFAULT_SIGNAL_STATE.nperseg);
  assert.equal(decoded.noverlap, DEFAULT_SIGNAL_STATE.noverlap);
});

test("isSignalStateV1/isSignalStateV2: distinguish the two shapes by their v tag", () => {
  const v1: SignalStateV1 = { v: 1, exprText: "t", sampleRate: "8", duration: "1" };
  assert.equal(isSignalStateV1(v1), true);
  assert.equal(isSignalStateV2(v1), false);
  assert.equal(isSignalStateV2(DEFAULT_SIGNAL_STATE), true);
});

test("isSignalStateV2: accepts a pre-#31 v2 state missing the peak-finding fields entirely (an old encoded URL hash)", () => {
  const prePeaksState = { v: 2, exprText: "sin(t)", sampleRate: "64", duration: "1", nperseg: "16", noverlap: "8" };
  assert.equal(isSignalStateV2(prePeaksState), true);
});

test("isSignalStateV2: rejects a peak-finding field with the wrong type when present", () => {
  const badShowPeaks = { ...DEFAULT_SIGNAL_STATE, showPeaks: "yes" };
  assert.equal(isSignalStateV2(badShowPeaks), false);
  const badMinAmplitude = { ...DEFAULT_SIGNAL_STATE, minAmplitude: 4 };
  assert.equal(isSignalStateV2(badMinAmplitude), false);
});

test("decodeSignalState: a pre-#31 encoded fragment (no peak-finding fields) decodes successfully rather than falling back to defaults", () => {
  const prePeaksState = { v: 2, exprText: "sin(t)", sampleRate: "64", duration: "1", nperseg: "16", noverlap: "8" };
  const encoded = Buffer.from(JSON.stringify(prePeaksState)).toString("base64url");
  const decoded = decodeSignalState(encoded);
  assert.notEqual(decoded, null);
  assert.equal(decoded?.exprText, "sin(t)");
  assert.equal(decoded?.showPeaks, undefined);
});

test("encodeSignalState/decodeSignalState: round-trips the full state including the new peak-finding fields", () => {
  const state = { ...DEFAULT_SIGNAL_STATE, showPeaks: true, minAmplitude: "0.5", minSpacingHz: "2", minProminence: "0.1" };
  const decoded = decodeSignalState(encodeSignalState(state));
  assert.deepEqual(decoded, state);
});
