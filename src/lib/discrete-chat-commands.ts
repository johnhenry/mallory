/**
 * Contextual chat commands for DiscretePanel (#339's "notable gap":
 * `resolveDiscreteNavigationCommand` in nl-query-discrete.ts exists but only
 * handles LITERAL-bearing phrasings ("cayley table of Z/6", "factor 3599")
 * typed from a DIFFERENT panel's chat box, navigating here with the state
 * prefilled -- DiscretePanel had no NL surface of its own for querying
 * whatever's already entered. Same "small, panel-local pattern table"
 * shape as matrix-chat-commands.ts (issue #46 item 1), which this
 * mirrors directly: DiscretePanel, like MatrixPanel, already computes and
 * displays every section (group/gcd/factorization/CRT) together with no
 * separate "mode" to select, so a contextual command's only job is to
 * surface an already-computed value back through the chat log.
 */
import type { CellGraph } from "./cell-graph.ts";
import type { CellIdsDiscrete } from "./cell-ids.ts";
import type { CrtResult, FactorizationResult, GroupInfo, TracedGcd } from "./discrete-math.ts";

export interface DiscreteChatCommandContext {
  graph: CellGraph;
  ids: CellIdsDiscrete;
}

export interface DiscreteChatCommandResult {
  ok: boolean;
  message: string;
}

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

interface CommandPattern {
  regex: RegExp;
  handle: (ctx: DiscreteChatCommandContext) => DiscreteChatCommandResult;
}

const PATTERNS: CommandPattern[] = [
  {
    regex: /^\s*is\s+this\s+(?:a\s+)?group\??\s*$/i,
    handle: (ctx) => {
      const info = ctx.graph.get<Result<GroupInfo>>(ctx.ids.groupInfo);
      if (!info.ok) return { ok: false, message: info.message };
      const { isGroup, isAbelian } = info.value;
      return { ok: true, message: isGroup ? `Yes -- and it's ${isAbelian ? "abelian" : "non-abelian"}.` : "No, this doesn't satisfy the group axioms." };
    },
  },
  {
    regex: /^\s*identity\s+of\s+this\s+group\s*$/i,
    handle: (ctx) => {
      const info = ctx.graph.get<Result<GroupInfo>>(ctx.ids.groupInfo);
      if (!info.ok) return { ok: false, message: info.message };
      const { identityIndex, labels } = info.value;
      return identityIndex === null
        ? { ok: false, message: "This isn't a group, so it has no identity element." }
        : { ok: true, message: `Identity: ${labels[identityIndex]}` };
    },
  },
  {
    regex: /^\s*gcd\s+of\s+(?:this|these(?:\s+numbers)?)\s*$/i,
    handle: (ctx) => {
      const result = ctx.graph.get<Result<TracedGcd>>(ctx.ids.gcdResult);
      return result.ok ? { ok: true, message: `gcd = ${result.value.gcd.toString()}` } : { ok: false, message: result.message };
    },
  },
  {
    regex: /^\s*factor(?:ize)?\s+this(?:\s+number)?\s*$/i,
    handle: (ctx) => {
      const result = ctx.graph.get<Result<FactorizationResult>>(ctx.ids.factorizeResult);
      if (!result.ok) return { ok: false, message: result.message };
      const n = ctx.graph.get<string>(ctx.ids.factorizeN);
      return {
        ok: true,
        message: result.value.isPrime ? `${n} is prime.` : result.value.factors.map(([p, e]) => (e === 1 ? p.toString() : `${p}^${e}`)).join(" × "),
      };
    },
  },
  {
    regex: /^\s*(?:solve\s+this\s+crt|crt\s+(?:result|of\s+this))\s*$/i,
    handle: (ctx) => {
      const result = ctx.graph.get<Result<CrtResult | { ok: false; message: string }>>(ctx.ids.crtResult);
      if (!result.ok) return { ok: false, message: result.message };
      return result.value.ok
        ? { ok: true, message: `x ≡ ${result.value.x.toString()} (mod ${result.value.modulus.toString()})` }
        : { ok: false, message: result.value.message };
    },
  },
];

/** Resolves a chat message to a DiscretePanel query, or null if `input` doesn't match any known contextual phrasing. */
export function resolveDiscreteChatCommand(input: string, ctx: DiscreteChatCommandContext): DiscreteChatCommandResult | null {
  for (const { regex, handle } of PATTERNS) {
    if (!regex.test(input)) continue;
    try {
      return handle(ctx);
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }
  return null;
}
