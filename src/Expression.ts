import { Environment } from "./Environment.ts";
import { StringEvaluator } from "./StringEvaluator.ts";

/**
 * Expression — a named formula over a list of independent variables, evaluated
 * by substituting values and delegating to {@link StringEvaluator}. Ported from
 * Mallory's ActionScript `Expression`. (The dead `mx.messaging` import is dropped.)
 */
export class Expression {
  private readonly _representation: string;
  private readonly _indeVars: string[];

  constructor(representation: unknown = "", independentVariables: string[] | null = null) {
    this._representation = String(representation);
    this._indeVars = independentVariables ?? [];
  }

  indeVarString(): string {
    return this._indeVars.join(",");
  }

  toString(expanded = true, name = "function"): string {
    if (expanded) return `${name}(${this.indeVarString()})=${this._representation}`;
    return this._representation;
  }

  /**
   * Evaluate the expression. `values` are bound to the independent variables
   * (in order); an outer `environment` supplies everything else.
   */
  evaluate(values: unknown = null, environment: Environment | null = null): unknown {
    const args = Array.isArray(values) ? values : [values];

    if (environment === null) {
      const subEnvironment = new Environment();
      for (let i = 0; i < this._indeVars.length; i++) {
        subEnvironment.assign(this._indeVars[i] as string, args[i]);
      }
      return StringEvaluator.evaluate(this._representation, subEnvironment);
    }

    const subEnvironment = environment.clone();
    for (let i = 0; i < this._indeVars.length; i++) {
      subEnvironment.assign(this._indeVars[i] as string, args[i]);
    }
    return StringEvaluator.evaluate(StringEvaluator.evaluate(this._representation, subEnvironment), environment);
  }
}
