import assert from "node:assert/strict";
import { test } from "node:test";
import { CellGraph } from "@johnhenry/math";
import { cellIds, TIME_CELL } from "./cell-ids.ts";
import { resolveChatCommand, type ChatCommandContext } from "./chat-commands.ts";
import { interpolateKeyframes, type Keyframe } from "./timeline.ts";

function makeContext(overrides: Partial<ChatCommandContext> = {}): { ctx: ChatCommandContext; calls: Record<string, unknown[]> } {
  const graph = new CellGraph();
  const ids = cellIds("f");
  graph.set(TIME_CELL, 0);
  graph.set(ids.expr, "a*x");
  graph.set(ids.param("a"), 2);
  graph.set(ids.structure, null as number | null);
  const calls: Record<string, unknown[]> = { setSource: [], setMode: [], setPlaying: [], setLoop: [], setSpeed: [] };
  const ctx: ChatCommandContext = {
    graph,
    ids,
    freeVars: ["a"],
    setSource: (v) => calls.setSource.push(v),
    setMode: (v) => calls.setMode.push(v),
    setPlaying: (v) => calls.setPlaying.push(v),
    setLoop: (v) => calls.setLoop.push(v),
    setSpeed: (v) => calls.setSpeed.push(v),
    ...overrides,
  };
  return { ctx, calls };
}

test("returns null for an unrecognized phrasing", () => {
  const { ctx } = makeContext();
  assert.equal(resolveChatCommand("what is the meaning of life", ctx), null);
});

test("'plot <expr>' sets the expression cell and calls setSource", () => {
  const { ctx, calls } = makeContext();
  const result = resolveChatCommand("plot x^2", ctx);
  assert.equal(result?.ok, true);
  assert.equal(ctx.graph.get<string>(ctx.ids.expr), "x^2");
  assert.deepEqual(calls.setSource, ["x^2"]);
});

test("'set <name> to <number>' writes the param cell", () => {
  const { ctx } = makeContext();
  const result = resolveChatCommand("set a to 5", ctx);
  assert.equal(result?.ok, true);
  assert.equal(ctx.graph.get<number>(ctx.ids.param("a")), 5);
});

test("'set <name> to <number>' fails cleanly for an unknown parameter", () => {
  const { ctx } = makeContext();
  const result = resolveChatCommand("set b to 5", ctx);
  assert.equal(result?.ok, false);
});

test("'increase <name> by <amount>' nudges the param up", () => {
  const { ctx } = makeContext();
  const result = resolveChatCommand("increase a by 3", ctx);
  assert.equal(result?.ok, true);
  assert.equal(ctx.graph.get<number>(ctx.ids.param("a")), 5);
});

test("'decrease <name>' with no amount nudges down by a default fraction of the slider range", () => {
  const { ctx } = makeContext();
  resolveChatCommand("decrease a", ctx);
  assert.ok(ctx.graph.get<number>(ctx.ids.param("a")) < 2);
});

test("'make it steeper' resolves the sole free variable when none is named", () => {
  const { ctx } = makeContext();
  resolveChatCommand("make it steeper", ctx);
  assert.ok(ctx.graph.get<number>(ctx.ids.param("a")) > 2);
});

test("'make it flatter' with an ambiguous target (multiple free vars, none named) asks which one", () => {
  const { ctx } = makeContext({ freeVars: ["a", "b"] });
  const result = resolveChatCommand("make it flatter", ctx);
  assert.equal(result?.ok, false);
  assert.match(result!.message, /which parameter/i);
});

test("'animate <name> from <a> to <b> over <n>s' redefines the param as a keyframe track", () => {
  const { ctx } = makeContext();
  const result = resolveChatCommand("animate a from 0 to 10 over 5s", ctx);
  assert.equal(result?.ok, true);
  const track = ctx.graph.get<Keyframe[]>(ctx.ids.track("a"));
  assert.deepEqual(track, [{ t: 0, value: 0 }, { t: 5, value: 10 }]);
  assert.equal(interpolateKeyframes(track, 2.5), 5);
  ctx.graph.set(TIME_CELL, 2.5);
  assert.equal(ctx.graph.get<number>(ctx.ids.param("a")), 5);
});

test("'stop animating <name>' reverts the param to a plain static cell", () => {
  const { ctx } = makeContext();
  resolveChatCommand("animate a from 0 to 10 over 5s", ctx);
  ctx.graph.set(TIME_CELL, 5);
  resolveChatCommand("stop animating a", ctx);
  assert.equal(ctx.graph.get<Keyframe[] | undefined>(ctx.ids.track("a")), undefined);
  const before = ctx.graph.get<number>(ctx.ids.param("a"));
  ctx.graph.set(TIME_CELL, 0); // no longer wired to TIME_CELL, so this must be a no-op for `a`
  assert.equal(ctx.graph.get<number>(ctx.ids.param("a")), before);
});

test("'play'/'pause' call setPlaying", () => {
  const { ctx, calls } = makeContext();
  resolveChatCommand("play", ctx);
  resolveChatCommand("pause", ctx);
  assert.deepEqual(calls.setPlaying, [true, false]);
});

test("'loop on'/'loop off' call setLoop", () => {
  const { ctx, calls } = makeContext();
  resolveChatCommand("loop off", ctx);
  assert.deepEqual(calls.setLoop, [false]);
});

test("'speed <n>' calls setSpeed", () => {
  const { ctx, calls } = makeContext();
  resolveChatCommand("speed 2x", ctx);
  assert.deepEqual(calls.setSpeed, [2]);
});

test("'switch to exact mode' / 'use float' call setMode", () => {
  const { ctx, calls } = makeContext();
  resolveChatCommand("switch to exact mode", ctx);
  resolveChatCommand("use float", ctx);
  assert.deepEqual(calls.setMode, ["exact", "float"]);
});

test("'use real numbers' clears the structure cell", () => {
  const { ctx } = makeContext();
  ctx.graph.set(ctx.ids.structure, 7);
  resolveChatCommand("use real numbers", ctx);
  assert.equal(ctx.graph.get<number | null>(ctx.ids.structure), null);
});

test("'use GF(7)' and 'switch to Z/5Z' set the structure modulus", () => {
  const { ctx } = makeContext();
  resolveChatCommand("use GF(7)", ctx);
  assert.equal(ctx.graph.get<number | null>(ctx.ids.structure), 7);
  resolveChatCommand("switch to Z/5Z", ctx);
  assert.equal(ctx.graph.get<number | null>(ctx.ids.structure), 5);
});
