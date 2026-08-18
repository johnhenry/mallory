import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_ML_PLAYGROUND_STATE,
  decodeMlPlaygroundState,
  encodeMlPlaygroundState,
  isMlPlaygroundStateV1,
  isMlPlaygroundStateV2,
  isMlPlaygroundStateV3,
  type MlPlaygroundStateV1,
  type MlPlaygroundStateV2,
} from "./ml-playground-state.ts";

test("encodeMlPlaygroundState/decodeMlPlaygroundState: the default state round-trips exactly", () => {
  const encoded = encodeMlPlaygroundState(DEFAULT_ML_PLAYGROUND_STATE);
  assert.deepEqual(decodeMlPlaygroundState(encoded), DEFAULT_ML_PLAYGROUND_STATE);
});

test("decodeMlPlaygroundState: an unrecognized/malformed fragment returns null rather than throwing", () => {
  assert.equal(decodeMlPlaygroundState("not valid base64url json"), null);
  assert.equal(decodeMlPlaygroundState(""), null);
});

test('encodeMlPlaygroundState/decodeMlPlaygroundState: a "drawn" dataset round-trips (regression: v1\'s DATASET_TYPES list omitted "drawn", so this used to silently fall back to the default state)', () => {
  const state = { ...DEFAULT_ML_PLAYGROUND_STATE, dataset: "drawn" as const };
  const decoded = decodeMlPlaygroundState(encodeMlPlaygroundState(state));
  assert.deepEqual(decoded, state);
});

test('encodeMlPlaygroundState/decodeMlPlaygroundState: issue #253\'s "csv" dataset round-trips its csvPoints and classNames', () => {
  const state = {
    ...DEFAULT_ML_PLAYGROUND_STATE,
    dataset: "csv" as const,
    csvPoints: [
      { x: 1, y: 2, label: 0 },
      { x: 3, y: 4, label: 1 },
      { x: 5, y: 6, label: 2 },
    ],
    classNames: ["cat", "dog", "bird"],
  };
  const decoded = decodeMlPlaygroundState(encodeMlPlaygroundState(state));
  assert.deepEqual(decoded, state);
});

test("decodeMlPlaygroundState: upgrades a v1 payload to v3 with dropout defaulted off and no csvPoints/classNames", () => {
  const v1: MlPlaygroundStateV1 = {
    v: 1,
    dataset: "xor",
    pointsPerClass: "40",
    dataSeed: "3",
    modelSeed: "9",
    hidden: "6",
    lr: "0.1",
    epochs: "100",
  };
  const decoded = decodeMlPlaygroundState(encodeMlPlaygroundState(v1 as never));
  assert.deepEqual(decoded, { ...v1, v: 3, dropout: DEFAULT_ML_PLAYGROUND_STATE.dropout });
});

test("decodeMlPlaygroundState: upgrades a v2 payload to v3 unchanged otherwise", () => {
  const v2: MlPlaygroundStateV2 = {
    v: 2,
    dataset: "rings",
    pointsPerClass: "25",
    dataSeed: "1",
    modelSeed: "2",
    hidden: "10",
    lr: "0.03",
    epochs: "50",
    dropout: "0.2",
    useSchedule: true,
    stepSize: "10",
    gamma: "0.9",
  };
  const decoded = decodeMlPlaygroundState(encodeMlPlaygroundState(v2 as never));
  assert.deepEqual(decoded, { ...v2, v: 3 });
});

test("isMlPlaygroundStateV3: rejects a csvPoints entry with a non-numeric or negative/fractional label", () => {
  const base = { ...DEFAULT_ML_PLAYGROUND_STATE, dataset: "csv" as const };
  assert.equal(isMlPlaygroundStateV3({ ...base, csvPoints: [{ x: 1, y: 2, label: -1 }] }), false);
  assert.equal(isMlPlaygroundStateV3({ ...base, csvPoints: [{ x: 1, y: 2, label: 0.5 }] }), false);
  assert.equal(isMlPlaygroundStateV3({ ...base, csvPoints: [{ x: "1", y: 2, label: 0 }] }), false);
  assert.equal(isMlPlaygroundStateV3({ ...base, csvPoints: [{ x: 1, y: 2, label: 0 }] }), true);
});

test("isMlPlaygroundStateV3: rejects a non-string classNames entry", () => {
  const base = { ...DEFAULT_ML_PLAYGROUND_STATE };
  assert.equal(isMlPlaygroundStateV3({ ...base, classNames: ["a", 2] }), false);
  assert.equal(isMlPlaygroundStateV3({ ...base, classNames: ["a", "b"] }), true);
});

test("isMlPlaygroundStateV1/isMlPlaygroundStateV2: reject a v3-only payload", () => {
  assert.equal(isMlPlaygroundStateV1(DEFAULT_ML_PLAYGROUND_STATE), false);
  assert.equal(isMlPlaygroundStateV2(DEFAULT_ML_PLAYGROUND_STATE), false);
});
