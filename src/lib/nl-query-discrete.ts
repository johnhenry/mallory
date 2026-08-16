import { DEFAULT_DISCRETE_STATE, encodeDiscreteState, type DiscreteState } from "./discrete-state.ts";

/**
 * State-prefilled navigation for discrete-math chat phrasings (issue #46's
 * remaining scope: '"cayley table of Z/6" / "factor 3599" -> discrete
 * panel (same shape as the matrix case: group-kind/modulus and a bare
 * integer, not an expression string -- the state-prefilled-navigation
 * mechanism from #173 is directly reusable here, just needs its own
 * parser)'. Same shape as `nl-query-matrix.ts`: a `{to, search, hash}`
 * object matching TanStack Router's `navigate()` directly, since the
 * input here (a group descriptor, or a bare integer) is a different shape
 * than `nl-query.ts`'s expression-string contract.
 *
 * DiscretePanel always computes the Cayley table, GCD, factorization, and
 * CRT sections together for whatever's entered (see DiscretePanel.tsx) --
 * so, same as the matrix case, there's no separate "mode" to select; each
 * phrasing below just prefills the one field it's about, leaving every
 * other field at its default.
 */
export interface DiscreteNavigationCommand {
  to: string;
  search: { tab: string };
  hash: string;
}

const CAYLEY_CYCLIC_PATTERN = /^cayley\s+table\s+of\s+z[/_](\d+)$/i;
const CAYLEY_SYMMETRIC_PATTERN = /^cayley\s+table\s+of\s+s[/_](\d+)$/i;
const FACTOR_PATTERN = /^factor(?:ize)?\s+(\d+)$/i;

export function resolveDiscreteNavigationCommand(input: string): DiscreteNavigationCommand | null {
  const trimmed = input.trim();

  const cyclic = trimmed.match(CAYLEY_CYCLIC_PATTERN);
  if (cyclic) return toCommand({ ...DEFAULT_DISCRETE_STATE, groupKind: "cyclic", groupN: cyclic[1] as string });

  const symmetric = trimmed.match(CAYLEY_SYMMETRIC_PATTERN);
  if (symmetric) return toCommand({ ...DEFAULT_DISCRETE_STATE, groupKind: "symmetric", groupN: symmetric[1] as string });

  const factor = trimmed.match(FACTOR_PATTERN);
  if (factor) return toCommand({ ...DEFAULT_DISCRETE_STATE, factorizeN: factor[1] as string });

  return null;
}

function toCommand(state: DiscreteState): DiscreteNavigationCommand {
  return { to: "/data", search: { tab: "discrete" }, hash: encodeDiscreteState(state) };
}
