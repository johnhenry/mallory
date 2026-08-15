import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_WORKSPACE_STATE, decodeWorkspaceState, encodeWorkspaceState } from "./workspace-state.ts";

test("round-trips the default (empty) workspace state through encode/decode", () => {
  const fragment = encodeWorkspaceState(DEFAULT_WORKSPACE_STATE);
  assert.deepEqual(decodeWorkspaceState(fragment), DEFAULT_WORKSPACE_STATE);
});

test("round-trips a workspace with several named variables", () => {
  const state = {
    v: 1 as const,
    variables: [
      { name: "k", value: 3 },
      { name: "amplitude", value: -2.5 },
      { name: "n", value: 0 },
    ],
  };
  assert.deepEqual(decodeWorkspaceState(encodeWorkspaceState(state)), state);
});

test("decodeWorkspaceState returns null for garbage or wrong-shape input rather than throwing", () => {
  assert.equal(decodeWorkspaceState("not-valid-base64url-json!!!"), null);
  assert.equal(decodeWorkspaceState(""), null);
  const badFragment = encodeWorkspaceState as unknown as (s: unknown) => string;
  assert.equal(decodeWorkspaceState(badFragment({ v: 1, variables: "nope" })), null);
  assert.equal(decodeWorkspaceState(badFragment({ v: 1, variables: [{ name: "k" }] })), null); // missing value
  assert.equal(decodeWorkspaceState(badFragment({ v: 1, variables: [{ name: "", value: 1 }] })), null); // empty name
  assert.equal(decodeWorkspaceState(badFragment({ v: 2, variables: [] })), null); // wrong version
});
