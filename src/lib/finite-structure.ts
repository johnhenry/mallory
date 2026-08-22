import { Structure } from "@johnhenry/math";

/** A finite algebraic structure paired with an explicit enumeration of its elements, since {@link Structure} itself has no enumeration API. */
export interface FiniteStructure {
  readonly label: string;
  readonly structure: Structure<number>;
  readonly elements: number[];
}

/** The ring of integers modulo `n` (a field when `n` is prime, e.g. GF(7)). */
export function integersModuloStructure(n: number): FiniteStructure {
  return {
    label: `Z/${n}Z`,
    structure: Structure.integersModulo(n),
    elements: Array.from({ length: n }, (_, i) => i),
  };
}

/** The Boolean ring GF(2). */
export function booleanRingStructure(): FiniteStructure {
  return { label: "GF(2)", structure: Structure.booleanRing(), elements: [0, 1] };
}
