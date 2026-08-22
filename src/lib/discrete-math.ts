import { GroupTheory, NumberTheory, Permutation } from "@johnhenry/math";

export type GroupKind = "cyclic" | "symmetric";

export interface GroupInfo {
  /** Display label for each element, in a fixed order shared by the table's rows/columns. */
  labels: string[];
  /** table[i][j] = index (into labels) of elements[i] "op" elements[j]. */
  table: number[][];
  isGroup: boolean;
  isAbelian: boolean;
  identityIndex: number | null;
  /** The order of each element (least k>=1 with element^k = identity), or null when there's no identity to measure against. */
  elementOrders: (number | null)[];
}

const MAX_SYMMETRIC_N = 5; // 5! = 120 -- already a big table; 6! = 720 would be unusable in a browser grid

/**
 * Builds a Cayley table plus the standard group-axiom badges for one of two
 * concrete finite groups -- Zn under addition (`GroupTheory.cyclicGroup`) or
 * Sn, the symmetric group on n symbols (`GroupTheory.symmetricGroup`, via
 * `Permutation.compose`/`Permutation.equal`). `GroupTheory.cayleyTable`
 * returns actual elements, not indices, so this maps each result back to an
 * index for a compact numeric table using the group's own equality test.
 */
export function buildGroupInfo(kind: GroupKind, n: number): GroupInfo {
  if (!Number.isInteger(n) || n < 1) throw new Error("n must be a positive integer.");
  if (kind === "symmetric" && n > MAX_SYMMETRIC_N) throw new Error(`Sn is only supported up to n=${MAX_SYMMETRIC_N} (n! elements).`);

  if (kind === "cyclic") {
    const { elements, op, identity } = GroupTheory.cyclicGroup(n);
    const eq = (a: number, b: number) => a === b;
    return buildFromElements(elements, op, eq, identity, (x) => String(x));
  }

  const elements = GroupTheory.symmetricGroup(n);
  const op = Permutation.compose<number>;
  const eq = Permutation.equal<number>;
  const identity = GroupTheory.findIdentity(elements, op, eq);
  return buildFromElements(elements, op, eq, identity, (p) => p.toString());
}

function buildFromElements<T>(
  elements: readonly T[],
  op: (a: T, b: T) => T,
  eq: (a: T, b: T) => boolean,
  identity: T | null,
  label: (t: T) => string,
): GroupInfo {
  const indexOf = (x: T): number => {
    const idx = elements.findIndex((e) => eq(e, x));
    if (idx === -1) throw new Error("Operation produced an element outside the set -- not closed.");
    return idx;
  };

  const rawTable = GroupTheory.cayleyTable(elements, op);
  const table = rawTable.map((row) => row.map((cell) => indexOf(cell)));

  const isGroup = GroupTheory.isGroup(elements, op, eq);
  const isAbelian = isGroup && GroupTheory.isAbelian(elements, op, eq);
  const identityIndex = identity !== null ? indexOf(identity) : null;
  const elementOrders = elements.map((e) => (identity !== null ? GroupTheory.elementOrder(e, op, eq, identity, elements.length + 1) : null));

  return { labels: elements.map(label), table, isGroup, isAbelian, identityIndex, elementOrders };
}

export interface GcdStep {
  a: bigint;
  b: bigint;
  q: bigint;
  r: bigint;
}

export interface TracedGcd {
  steps: GcdStep[];
  gcd: bigint;
}

/**
 * The Euclidean algorithm, step-traced (a-b-q-r per iteration) for a
 * walkthrough UI. `NumberTheory.gcd` (extended-Euclid based, bigint-safe)
 * only returns the final value, not the division sequence -- this is a
 * separate, from-scratch implementation, cross-checked against
 * `NumberTheory.gcd`'s own result in tests rather than trusted alone.
 */
export function tracedGcd(a: bigint, b: bigint): TracedGcd {
  const steps: GcdStep[] = [];
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const q = x / y;
    const r = x % y;
    steps.push({ a: x, b: y, q, r });
    x = y;
    y = r;
  }
  return { steps, gcd: x };
}

export interface FactorizationResult {
  factors: Array<[bigint, number]>;
  isPrime: boolean;
}

/** Wraps NumberTheory.factorize/isProbablePrime for the panel, uniformly validated (positive integer). */
export function factorizeForPanel(n: bigint): FactorizationResult {
  if (n < 2n) throw new Error("Enter an integer >= 2.");
  return { factors: NumberTheory.factorize(n), isPrime: NumberTheory.isProbablePrime(n) };
}

export interface CrtResult {
  ok: true;
  x: bigint;
  modulus: bigint;
}

/** Wraps NumberTheory.crt with a uniform not-ok result instead of null, matching this codebase's Result-object convention elsewhere rather than null-checking at call sites. */
export function solveCrt(remainders: bigint[], moduli: bigint[]): CrtResult | { ok: false; message: string } {
  if (remainders.length !== moduli.length) throw new Error("Need one remainder per modulus.");
  if (remainders.length === 0) throw new Error("Enter at least one congruence.");
  const result = NumberTheory.crt(remainders, moduli);
  if (result === null) return { ok: false, message: "No solution -- the moduli aren't pairwise coprime (or the system is inconsistent)." };
  return { ok: true, x: result.x, modulus: result.modulus };
}
