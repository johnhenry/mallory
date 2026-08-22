import { Symbolic } from "@johnhenry/math";
import { useModelContextTool } from "./use-model-context-tool.ts";

/**
 * General-purpose CAS WebMCP tools -- issue #40's "tool-name parity" item:
 * the in-page WebMCP layer previously only exposed panel-specific
 * `*_set_cell`-style tools (via `useCellGraphTools`), no general
 * `symbolic_*` tools, so an agent saw a different toolbox depending on
 * whether it arrived via the browser (WebMCP) or a hypothetical future
 * HTTP endpoint (`mallory-mcp`). Registered once at the app-shell level
 * (like `app_navigate`), not per-panel -- these operate on plain
 * expression strings, independent of any panel's own CellGraph state.
 *
 * Tool names and shapes mirror `mallory-mcp@0.0.2`'s server-side
 * `symbolic_parse/simplify/differentiate/integrate/solve/evaluate` set
 * (per the issue's own naming), built directly against `Symbolic`'s real
 * API already used throughout this codebase (see nl-query.ts for the same
 * method calls). Server-side `mallory-mcp` hosting itself (issue #40's item
 * 1) is a separate, larger piece needing its own auth/security-gating
 * design -- not part of this hook.
 */
export function useSymbolicTools(): void {
  useModelContextTool({
    name: "symbolic_parse",
    description: "Parse and normalize an expression string, returning its canonical form. Throws on a malformed expression.",
    inputSchema: {
      type: "object",
      properties: { expr: { type: "string", description: "The expression to parse, e.g. \"x^2 + 2*x + 1\"." } },
      required: ["expr"],
    } as const,
    handler: async (input: Record<string, unknown>) => Symbolic.toString(Symbolic.parse(String(input.expr ?? ""))),
  });

  useModelContextTool({
    name: "symbolic_simplify",
    description: "Algebraically simplify an expression, returning its simplified form.",
    inputSchema: {
      type: "object",
      properties: { expr: { type: "string", description: "The expression to simplify." } },
      required: ["expr"],
    } as const,
    handler: async (input: Record<string, unknown>) => Symbolic.toString(Symbolic.simplify(String(input.expr ?? ""))),
  });

  useModelContextTool({
    name: "symbolic_differentiate",
    description: "Differentiate an expression with respect to a variable (default \"x\"), returning the derivative.",
    inputSchema: {
      type: "object",
      properties: {
        expr: { type: "string", description: "The expression to differentiate." },
        variable: { type: "string", description: "The variable to differentiate with respect to. Defaults to \"x\"." },
      },
      required: ["expr"],
    } as const,
    handler: async (input: Record<string, unknown>) =>
      Symbolic.toString(Symbolic.differentiate(String(input.expr ?? ""), input.variable ? String(input.variable) : undefined)),
  });

  useModelContextTool({
    name: "symbolic_integrate",
    description:
      "Find the antiderivative of an expression with respect to a variable (default \"x\") using elementary rules. Throws if the expression isn't elementarily integrable.",
    inputSchema: {
      type: "object",
      properties: {
        expr: { type: "string", description: "The expression to integrate." },
        variable: { type: "string", description: "The variable to integrate with respect to. Defaults to \"x\"." },
      },
      required: ["expr"],
    } as const,
    handler: async (input: Record<string, unknown>) =>
      Symbolic.toString(Symbolic.integrate(String(input.expr ?? ""), input.variable ? String(input.variable) : undefined)),
  });

  useModelContextTool({
    name: "symbolic_solve",
    description:
      "Solve expr=0 for a variable (default \"x\"), returning every real root mallory-math can find (up to degree 6 polynomials; complex roots are not returned).",
    inputSchema: {
      type: "object",
      properties: {
        expr: { type: "string", description: "The expression to solve (implicitly equals zero -- e.g. \"x^2-4\" for x^2=4)." },
        variable: { type: "string", description: "The variable to solve for. Defaults to \"x\"." },
      },
      required: ["expr"],
    } as const,
    handler: async (input: Record<string, unknown>) =>
      Symbolic.solve(String(input.expr ?? ""), input.variable ? String(input.variable) : undefined).map((root) => Symbolic.toString(root)),
  });

  useModelContextTool({
    name: "symbolic_evaluate",
    description: "Numerically evaluate an expression, substituting any variable values given in env.",
    inputSchema: {
      type: "object",
      properties: {
        expr: { type: "string", description: "The expression to evaluate." },
        env: {
          type: "object",
          description: "Variable name -> numeric value bindings, e.g. { \"x\": 3 }.",
          additionalProperties: { type: "number" },
        },
      },
      required: ["expr"],
    } as const,
    handler: async (input: Record<string, unknown>) =>
      Symbolic.evaluate(String(input.expr ?? ""), (input.env as Record<string, number> | undefined) ?? {}),
  });
}
