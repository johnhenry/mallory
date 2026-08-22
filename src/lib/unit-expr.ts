import { Unit } from "@johnhenry/math-plus-unit";

/**
 * A minimal whitespace-tokenized arithmetic grammar over `@johnhenry/math-plus-unit`'s
 * `Unit` type: `<number> [<unit-symbol>]` operands combined with `+ - * /`
 * (standard precedence, left-associative, no parentheses -- matching
 * `Unit.pow`'s own "no parens in unit symbols" simplification stance), plus
 * a lowest-precedence `<expr> in <unit-symbol>` conversion suffix.
 *
 * `@johnhenry/math-plus-unit` itself only parses a UNIT STRING ("m/s^2") into a `Unit` --
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
    return simplifyUnit(value);
  }

  const exprTokens = tokens.slice(0, inIndex);
  const rest = tokens.slice(inIndex + 1);
  if (exprTokens.length === 0) throw new Error(`"in" needs an expression before it`);
  if (rest.length !== 1) throw new Error(`"in" needs exactly one unit after it`);
  const { value, pos } = parseExpr(exprTokens, 0, variables);
  if (pos !== exprTokens.length) throw new Error(`unexpected token "${exprTokens[pos]}" before "in"`);
  // An explicit `in <unit>` is the user asking for THAT symbol -- no
  // simplification pass on top of it.
  return value.to(rest[0] as string);
}

/**
 * Cancels textually-identical unit factors in a combined symbol
 * (mallory#305 bug 1): `Unit.mul`/`Unit.div` track the DIMENSION
 * correctly but only concatenate symbols, so `5 m/s * 3 s` came back as
 * `15 m/s*s` -- dimensionally plain length, displayed as if it weren't.
 *
 * Deliberately textual, not dimensional: only factors with the SAME symbol
 * cancel (`s` against `s`, never `s` against `min`), so the conversion
 * factor is exactly 1 and the user's own choice of units is preserved
 * (`3 km / 2 s` stays `km/s`, never silently converts to base SI). The
 * rebuilt symbol is verified by round-tripping through `Unit.to` -- same
 * dimension by construction, so `to` can't throw for a real cancellation --
 * and ANY failure (unparseable rebuild, negative-only exponents this
 * grammar can't spell) falls back to the unsimplified original rather than
 * erroring: worst case is the old display, never a wrong value.
 */
export function simplifyUnit(unit: Unit): Unit {
  const parsed = symbolFactors(unit.symbol);
  if (parsed === null) return unit;
  const { factors, factorTokens } = parsed;
  // No symbol appears twice -> nothing can combine or cancel; keep the
  // user's own symbol verbatim (rebuilding would only reorder it).
  if (factors.size === factorTokens) return unit;
  const survivors = [...factors.entries()].filter(([, exp]) => exp !== 0);
  if (survivors.length === 0) {
    // Everything cancelled (e.g. `6 s / 3 s`) -- identical-symbol
    // cancellation has conversion factor exactly 1, so the magnitude is
    // already the dimensionless value.
    return Unit.dimensionless(unit.value);
  }
  const numerator = survivors.filter(([, exp]) => exp > 0);
  const denominator = survivors.filter(([, exp]) => exp < 0);
  // This grammar (like @johnhenry/math-plus-unit's own) has no way to spell a
  // denominator-only symbol ("s^-1") -- fall back rather than guess.
  if (numerator.length === 0) return unit;
  const rebuilt =
    numerator.map(([sym, exp]) => (exp === 1 ? sym : `${sym}^${exp}`)).join("*") +
    denominator.map(([sym, exp]) => (exp === -1 ? `/${sym}` : `/${sym}^${-exp}`)).join("");
  try {
    return unit.to(rebuilt);
  } catch {
    return unit;
  }
}

/**
 * Factors a @johnhenry/math-plus-unit combined symbol ("m/s*s", "m/s^2") into
 * symbol -> net exponent, reading it with the same left-associative
 * no-parentheses grammar @johnhenry/math-plus-unit itself documents: each `/` negates
 * only the single factor that follows it (`a/b*c` is `(a/b)*c`). Returns
 * `null` for anything unexpected (empty symbol, malformed exponent) so the
 * caller can fall back to no simplification.
 */
function symbolFactors(symbol: string): { factors: Map<string, number>; factorTokens: number } | null {
  if (symbol === "") return null;
  const factors = new Map<string, number>();
  let factorTokens = 0;
  const parts = symbol.split(/([*/])/);
  let op = "*";
  for (const part of parts) {
    if (part === "*" || part === "/") {
      op = part;
      continue;
    }
    const match = /^([A-Za-zµΩ°]+)(?:\^(-?\d+))?$/.exec(part);
    if (!match) return null;
    factorTokens++;
    const sym = match[1] as string;
    const exp = match[2] !== undefined ? Number(match[2]) : 1;
    const signed = op === "/" ? -exp : exp;
    factors.set(sym, (factors.get(sym) ?? 0) + signed);
  }
  return { factors, factorTokens };
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
