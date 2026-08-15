/**
 * URL-state schema for ComplexPanel -- the raw inputs only (see
 * cell-ids.ts's cellIdsComplex); every result cell is purely derived.
 */
export interface ComplexStateV1 {
  v: 1;
  exprText: string;
  probeRe: string;
  probeIm: string;
  showRootsOfUnity: boolean;
  rootsN: string;
}

export type ConformalGridType = "rectangular" | "polar";

export interface ComplexStateV2 {
  v: 2;
  exprText: string;
  probeRe: string;
  probeIm: string;
  showRootsOfUnity: boolean;
  rootsN: string;
  showConformalGrid: boolean;
  conformalGridType: ConformalGridType;
  conformalGridSpacing: string;
}

export interface ComplexStateV3 {
  v: 3;
  exprText: string;
  probeRe: string;
  probeIm: string;
  showRootsOfUnity: boolean;
  rootsN: string;
  showConformalGrid: boolean;
  conformalGridType: ConformalGridType;
  conformalGridSpacing: string;
  showZeros: boolean;
  showPoles: boolean;
}

export type ComplexState = ComplexStateV3;

export const DEFAULT_COMPLEX_STATE: ComplexState = {
  v: 3,
  exprText: "z^2 + 1",
  probeRe: "1",
  probeIm: "1",
  showRootsOfUnity: true,
  rootsN: "5",
  showConformalGrid: false,
  conformalGridType: "rectangular",
  conformalGridSpacing: "0.5",
  showZeros: false,
  showPoles: false,
};

export function encodeComplexState(state: ComplexState): string {
  return base64UrlEncode(JSON.stringify(state));
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. Upgrades a v1/v2 payload up to v3 with the newer fields defaulted off. */
export function decodeComplexState(fragment: string): ComplexState | null {
  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(fragment));
    if (isComplexStateV3(parsed)) return parsed;
    if (isComplexStateV2(parsed)) return upgradeV2ToV3(parsed);
    if (isComplexStateV1(parsed)) return upgradeV2ToV3(upgradeV1ToV2(parsed));
    return null;
  } catch {
    return null;
  }
}

function upgradeV1ToV2(v1: ComplexStateV1): ComplexStateV2 {
  return {
    ...v1,
    v: 2,
    showConformalGrid: DEFAULT_COMPLEX_STATE.showConformalGrid,
    conformalGridType: DEFAULT_COMPLEX_STATE.conformalGridType,
    conformalGridSpacing: DEFAULT_COMPLEX_STATE.conformalGridSpacing,
  };
}

function upgradeV2ToV3(v2: ComplexStateV2): ComplexStateV3 {
  return {
    ...v2,
    v: 3,
    showZeros: DEFAULT_COMPLEX_STATE.showZeros,
    showPoles: DEFAULT_COMPLEX_STATE.showPoles,
  };
}

function hasV1Fields(v: Record<string, unknown>): boolean {
  if (typeof v.showRootsOfUnity !== "boolean") return false;
  const fields = ["exprText", "probeRe", "probeIm", "rootsN"] as const;
  return fields.every((f) => typeof v[f] === "string");
}

function hasV2Fields(v: Record<string, unknown>): boolean {
  if (!hasV1Fields(v)) return false;
  if (typeof v.showConformalGrid !== "boolean" || typeof v.conformalGridSpacing !== "string") return false;
  return v.conformalGridType === "rectangular" || v.conformalGridType === "polar";
}

export function isComplexStateV1(value: unknown): value is ComplexStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.v === 1 && hasV1Fields(v);
}

export function isComplexStateV2(value: unknown): value is ComplexStateV2 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.v === 2 && hasV2Fields(v);
}

export function isComplexStateV3(value: unknown): value is ComplexStateV3 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 3 || !hasV2Fields(v)) return false;
  return typeof v.showZeros === "boolean" && typeof v.showPoles === "boolean";
}

function base64UrlEncode(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
