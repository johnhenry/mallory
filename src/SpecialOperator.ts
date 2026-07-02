/**
 * SpecialOperator — a named symbolic operator (`+`, `-`, `*`, …) pairing a
 * textual representation (`rep`) with the name of the function that implements it
 * (`funct`). Ported from Mallory's ActionScript `SpecialOperator`; used by the
 * expression evaluator.
 */
export class SpecialOperator {
  readonly rep: string;
  readonly funct: string | null;

  constructor(rep: string, funct: string | null) {
    this.rep = rep;
    this.funct = funct;
  }

  toString(): string {
    return `Operator: ${this.rep}`;
  }

  static readonly Plus = new SpecialOperator("+", "add");
  static readonly Minus = new SpecialOperator("-", "subtract");
  static readonly Times = new SpecialOperator("*", "multiply");
  static readonly Divided = new SpecialOperator("/", "divide");
  static readonly Power = new SpecialOperator("^", "power");
  static readonly Modulous = new SpecialOperator("%", "mod");
  static readonly Elipses = new SpecialOperator("...", null);
  static readonly System = new SpecialOperator("#", null);
}
