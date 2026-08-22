import "mathlive";
import type { MathfieldElement } from "mathlive";
import { type CSSProperties, useEffect, useRef } from "react";

export interface MathInputProps {
  latex: string;
  onChange: (latex: string) => void;
  style?: CSSProperties;
}

/**
 * Wraps MathLive's `<math-field>` custom element imperatively (via
 * `document.createElement` inside a plain container ref) rather than as a
 * JSX intrinsic tag, since MathLive ships no React/JSX type declarations --
 * this sidesteps declaring a global `JSX.IntrinsicElements` augmentation for
 * one custom element.
 *
 * Deals only in LaTeX strings; translating to/from plain expression source
 * via `Symbolic.toLatex`/`fromLatex` is the caller's job (see
 * `ExpressionRow`'s usage) -- this component doesn't know about @johnhenry/math
 * at all.
 */
export function MathInput({ latex, onChange, style }: MathInputProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fieldRef = useRef<MathfieldElement | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const field = document.createElement("math-field") as MathfieldElement;
    field.value = latex;
    const handleInput = () => onChangeRef.current(field.value);
    field.addEventListener("input", handleInput);
    container.appendChild(field);
    fieldRef.current = field;
    return () => {
      field.removeEventListener("input", handleInput);
      container.removeChild(field);
      fieldRef.current = null;
    };
    // Mounted once; the `latex` prop's *later* changes are pushed into the
    // already-mounted field by the effect below instead of remounting it,
    // so an in-progress edit/cursor position isn't disturbed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const field = fieldRef.current;
    if (field && field.value !== latex) field.value = latex;
  }, [latex]);

  return <div ref={containerRef} style={style} />;
}
