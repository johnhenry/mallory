import { Unit } from "mallory-unit";

/**
 * A minimal whitespace-tokenized arithmetic grammar over `mallory-unit`'s
 * `Unit` type: `<number> [<unit-symbol>]` operands combined with `+ - * /`
 * (standard precedence, left-associative, no parentheses -- matching
 * `Unit.pow`'s own "no parens in unit symbols" simplification stance), plus
 * a lowest-precedence `<expr> in <unit-symbol>` conversion suffix.
 *
 * `mallory-unit` itself only parses a UNIT STRING ("m/s^2") into a `Unit` --
 * it has no expression grammar of its own for combining numbers/units/
 * operators into one line, which is what the calculator's "units" mode
 * needs. This is that small grammar, written by hand rather than routed
 * through `Symbolic` (whose `Expr` AST has no unit-carrying leaf type).
 *
 * v1 limitations, deliberate: no parentheses; unary minus only as part of a
 * numeral token with no space ("-5 m", not "- 5 m"); exactly one `in`
 * clause, applying to the whole preceding expression, at most once per
 * line; calculator variables (`name = expr`) are looked up as plain
 * dimensionless numbers in this mode (`variables`), not unit-carrying
 * values -- a variable assigned from a unit expression only remembers its
 * magnitude in whatever unit it last resolved to, not the unit itself.
 */
export function evaluateUnitExpr(source: string, variables: Record<string, number> = {}): Unit {
  const tokens = source.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) throw new Error("empty expression");

  const inIndex = tokens.indexOf("in");
  if (inIndex === -1) {
    const { value, pos } = parseExpr(tokens, 0, variables);
    if (pos !== tokens.length) throw new Error(`unexpected token "${tokens[pos]}"`);
    return value;
  }

  const exprTokens = tokens.slice(0, inIndex);
  const rest = tokens.slice(inIndex + 1);
  if (exprTokens.length === 0) throw new Error(`"in" needs an expression before it`);
  if (rest.length !== 1) throw new Error(`"in" needs exactly one unit after it`);
  const { value, pos } = parseExpr(exprTokens, 0, variables);
  if (pos !== exprTokens.length) throw new Error(`unexpected token "${exprTokens[pos]}" before "in"`);
  return value.to(rest[0] as string);
}

function parseExpr(tokens: string[], start: number, variables: Record<string, number>): { value: Unit; pos: number } {
  let { value: left, pos } = parseTerm(tokens, start, variables);
  while (pos < tokens.length && (tokens[pos] === "+" || tokens[pos] === "-")) {
    const op = tokens[pos] as string;
    const right = parseTerm(tokens, pos + 1, variables);
    left = op === "+" ? left.add(right.value) : left.sub(right.value);
    pos = right.pos;
  }
  return { value: left, pos };
}

function parseTerm(tokens: string[], start: number, variables: Record<string, number>): { value: Unit; pos: number } {
  let { value: left, pos } = parseOperand(tokens, start, variables);
  while (pos < tokens.length && (tokens[pos] === "*" || tokens[pos] === "/")) {
    const op = tokens[pos] as string;
    const right = parseOperand(tokens, pos + 1, variables);
    left = op === "*" ? left.mul(right.value) : left.div(right.value);
    pos = right.pos;
  }
  return { value: left, pos };
}

const OPERATORS = new Set(["+", "-", "*", "/", "in"]);

function parseOperand(tokens: string[], start: number, variables: Record<string, number>): { value: Unit; pos: number } {
  const numTok = tokens[start];
  if (numTok === undefined) throw new Error("expected a number");
  const parsed = Number(numTok);
  const num = !Number.isNaN(parsed) ? parsed : numTok in variables ? (variables[numTok] as number) : Number.NaN;
  if (Number.isNaN(num)) throw new Error(`"${numTok}" isn't a number or a known variable`);

  const next = tokens[start + 1];
  if (next !== undefined && !OPERATORS.has(next)) {
    return { value: Unit.of(num, next), pos: start + 2 };
  }
  return { value: Unit.dimensionless(num), pos: start + 1 };
}
