import assert from "node:assert/strict";
import { test } from "node:test";
import { CellGraph } from "./cell-graph.ts";
import { cellIdsDiscrete } from "./cell-ids.ts";
import { resolveDiscreteChatCommand } from "./discrete-chat-commands.ts";
import { buildGroupInfo, factorizeForPanel, solveCrt, tracedGcd, type GroupKind } from "./discrete-math.ts";

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

function seededGraph(opts: {
  groupKind?: GroupKind;
  groupN?: number;
  gcdA?: bigint;
  gcdB?: bigint;
  factorizeN?: bigint;
  crt?: { remainders: bigint[]; moduli: bigint[] };
}) {
  const graph = new CellGraph();
  const ids = cellIdsDiscrete("test");
  graph.define(ids.groupInfo, () => {
    if (opts.groupKind === undefined || opts.groupN === undefined) return { ok: false as const, message: "not seeded" };
    try {
      return { ok: true as const, value: buildGroupInfo(opts.groupKind, opts.groupN) };
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : String(e) };
    }
  });
  graph.define(ids.gcdResult, () => {
    if (opts.gcdA === undefined || opts.gcdB === undefined) return { ok: false as const, message: "not seeded" };
    return { ok: true as const, value: tracedGcd(opts.gcdA, opts.gcdB) };
  });
  graph.set(ids.factorizeN, opts.factorizeN !== undefined ? String(opts.factorizeN) : "");
  graph.define(ids.factorizeResult, () => {
    if (opts.factorizeN === undefined) return { ok: false as const, message: "not seeded" };
    return { ok: true as const, value: factorizeForPanel(opts.factorizeN) };
  });
  graph.define(ids.crtResult, () => {
    if (!opts.crt) return { ok: false as const, message: "not seeded" };
    return { ok: true as const, value: solveCrt(opts.crt.remainders, opts.crt.moduli) };
  });
  return { graph, ids };
}

test("resolveDiscreteChatCommand: returns null for an unrecognized phrasing", () => {
  const { graph, ids } = seededGraph({});
  assert.equal(resolveDiscreteChatCommand("what's the weather", { graph, ids }), null);
});

test('resolveDiscreteChatCommand: "is this a group" reports the already-computed group/abelian status', () => {
  const { graph, ids } = seededGraph({ groupKind: "cyclic", groupN: 5 }); // Z/5Z is abelian
  const result = resolveDiscreteChatCommand("is this a group", { graph, ids });
  assert.equal(result?.ok, true);
  assert.match(result!.message, /Yes.*abelian/);
});

test('resolveDiscreteChatCommand: "is this a group?" (with trailing question mark) is also recognized', () => {
  const { graph, ids } = seededGraph({ groupKind: "cyclic", groupN: 3 });
  const result = resolveDiscreteChatCommand("is this a group?", { graph, ids });
  assert.equal(result?.ok, true);
});

test('resolveDiscreteChatCommand: "identity of this group" reports the identity element\'s label', () => {
  const { graph, ids } = seededGraph({ groupKind: "cyclic", groupN: 4 });
  const result = resolveDiscreteChatCommand("identity of this group", { graph, ids });
  assert.equal(result?.ok, true);
  assert.match(result!.message, /^Identity: /);
});

test('resolveDiscreteChatCommand: "gcd of this" reports the hand-verified gcd', () => {
  // gcd(48, 18) = 6
  const { graph, ids } = seededGraph({ gcdA: 48n, gcdB: 18n });
  const result = resolveDiscreteChatCommand("gcd of this", { graph, ids });
  assert.equal(result?.ok, true);
  assert.equal(result?.message, "gcd = 6");
});

test('resolveDiscreteChatCommand: "gcd of these numbers" is also recognized (alternate phrasing)', () => {
  const { graph, ids } = seededGraph({ gcdA: 12n, gcdB: 8n });
  const result = resolveDiscreteChatCommand("gcd of these numbers", { graph, ids });
  assert.equal(result?.ok, true);
});

test('resolveDiscreteChatCommand: "factor this" reports the already-computed factorization', () => {
  // 12 = 2^2 * 3
  const { graph, ids } = seededGraph({ factorizeN: 12n });
  const result = resolveDiscreteChatCommand("factor this", { graph, ids });
  assert.equal(result?.ok, true);
  assert.equal(result?.message, "2^2 × 3");
});

test('resolveDiscreteChatCommand: "factorize this number" on a prime reports it\'s prime', () => {
  const { graph, ids } = seededGraph({ factorizeN: 17n });
  const result = resolveDiscreteChatCommand("factorize this number", { graph, ids });
  assert.equal(result?.ok, true);
  assert.equal(result?.message, "17 is prime.");
});

test('resolveDiscreteChatCommand: "crt result" reports the hand-verified solution', () => {
  // x ≡ 2 (mod 3), x ≡ 3 (mod 5) -> canonical solution x=8 (mod 15): hand check 8 mod 3 = 2, 8 mod 5 = 3. Correct.
  const { graph, ids } = seededGraph({ crt: { remainders: [2n, 3n], moduli: [3n, 5n] } });
  const result = resolveDiscreteChatCommand("crt result", { graph, ids });
  assert.equal(result?.ok, true);
  assert.equal(result?.message, "x ≡ 8 (mod 15)");
});

test('resolveDiscreteChatCommand: "solve this crt" is also recognized (alternate phrasing)', () => {
  const { graph, ids } = seededGraph({ crt: { remainders: [1n, 1n], moduli: [2n, 3n] } });
  const result = resolveDiscreteChatCommand("solve this crt", { graph, ids });
  assert.equal(result?.ok, true);
});

test("resolveDiscreteChatCommand: is case-insensitive and tolerant of extra whitespace", () => {
  const { graph, ids } = seededGraph({ gcdA: 10n, gcdB: 4n });
  const result = resolveDiscreteChatCommand("  GCD   OF   THIS  ", { graph, ids });
  assert.equal(result?.ok, true);
});

test('resolveDiscreteChatCommand: "is this a group" on a non-group set surfaces the false verdict, not an error', () => {
  const { graph, ids } = seededGraph({ groupKind: "cyclic", groupN: 0 }); // n=0 is not a valid group order
  const result = resolveDiscreteChatCommand("is this a group", { graph, ids });
  assert.equal(result?.ok, false);
});
