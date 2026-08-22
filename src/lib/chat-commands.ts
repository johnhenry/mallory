/**
 * Phase 10 MVP: conversational co-editing via a bounded set of rule-based
 * command phrasings -- deliberately not a free-form LLM agent, which is a
 * separate, larger infrastructure decision (provider, API keys, cost/latency)
 * left for later. Every recognized command performs exactly the same
 * CellGraph operation a human would trigger through the UI (the same
 * graph.set on a param/expr/structure cell, or the same keyframe-track shape
 * SliderControl's "Animate" toggle writes), so the chat channel and direct
 * manipulation can never diverge -- there's no separate "chat state," only
 * the one reactive graph both channels read and write.
 */
import type { CellGraph } from "@johnhenry/math";
import { TIME_CELL, type CellIds } from "./cell-ids.ts";
import { defaultSliderRange } from "./free-vars.ts";
import { interpolateKeyframes, type Keyframe } from "./timeline.ts";

export interface ChatCommandContext {
  graph: CellGraph;
  ids: CellIds;
  /** This pane's current free variables, used to resolve an unnamed target ("make it steeper"). */
  freeVars: string[];
  setSource: (source: string) => void;
  setMode: (mode: "float" | "exact") => void;
  setPlaying: (playing: boolean) => void;
  setLoop: (loop: boolean) => void;
  setSpeed: (speed: number) => void;
}

export interface ChatCommandResult {
  ok: boolean;
  message: string;
}

function resolveTarget(name: string | undefined, freeVars: string[]): string | ChatCommandResult {
  if (name) return name;
  if (freeVars.length === 1) return freeVars[0];
  if (freeVars.length === 0) return { ok: false, message: "This expression has no parameters to adjust." };
  return { ok: false, message: `Which parameter did you mean? (${freeVars.join(", ")})` };
}

function nudgeParam(ctx: ChatCommandContext, name: string, delta: number): ChatCommandResult {
  const id = ctx.ids.param(name);
  if (!ctx.graph.has(id)) return { ok: false, message: `No parameter named "${name}".` };
  const next = ctx.graph.get<number>(id) + delta;
  ctx.graph.set(id, next);
  return { ok: true, message: `Set ${name} = ${next.toFixed(3)}` };
}

// Mirrors SliderControl's toggleAnimated: a static param cell becomes a
// derived cell reading a keyframe track against the shared TIME_CELL.
function animateParam(ctx: ChatCommandContext, name: string, from: number, to: number, duration: number): ChatCommandResult {
  const id = ctx.ids.param(name);
  if (!ctx.graph.has(id)) return { ok: false, message: `No parameter named "${name}".` };
  const trackId = ctx.ids.track(name);
  ctx.graph.set(trackId, [
    { t: 0, value: from },
    { t: duration, value: to },
  ]);
  ctx.graph.define(id, () => interpolateKeyframes(ctx.graph.get<Keyframe[]>(trackId), ctx.graph.get<number>(TIME_CELL)));
  return { ok: true, message: `Animating ${name} from ${from} to ${to} over ${duration}s` };
}

interface CommandPattern {
  regex: RegExp;
  handle: (match: RegExpMatchArray, ctx: ChatCommandContext) => ChatCommandResult;
}

const PATTERNS: CommandPattern[] = [
  {
    regex: /^\s*(?:set\s+y\s*=\s*|plot\s+|graph\s+)(.+)$/i,
    handle: (m, ctx) => {
      const source = m[1].trim();
      ctx.graph.set(ctx.ids.expr, source);
      ctx.setSource(source);
      return { ok: true, message: `Plotted y = ${source}` };
    },
  },
  {
    regex: /^\s*set\s+(\w+)\s+to\s+(-?[\d.]+)\s*$/i,
    handle: (m, ctx) => {
      const [, name, valueStr] = m;
      const id = ctx.ids.param(name);
      if (!ctx.graph.has(id)) return { ok: false, message: `No parameter named "${name}".` };
      ctx.graph.set(id, Number(valueStr));
      return { ok: true, message: `Set ${name} = ${valueStr}` };
    },
  },
  {
    regex: /^\s*(increase|decrease)\s+(\w+)?(?:\s+by\s+(-?[\d.]+))?\s*$/i,
    handle: (m, ctx) => {
      const [, verb, name, byStr] = m;
      const target = resolveTarget(name, ctx.freeVars);
      if (typeof target !== "string") return target;
      const range = defaultSliderRange(target);
      const magnitude = byStr ? Number(byStr) : (range.max - range.min) * 0.1;
      return nudgeParam(ctx, target, verb.toLowerCase() === "increase" ? magnitude : -magnitude);
    },
  },
  {
    regex: /^\s*make\s+(?:it|this)\s+(steeper|flatter|bigger|smaller)(?:\s+(\w+))?\s*$/i,
    handle: (m, ctx) => {
      const [, adj, name] = m;
      const target = resolveTarget(name, ctx.freeVars);
      if (typeof target !== "string") return target;
      const range = defaultSliderRange(target);
      const magnitude = (range.max - range.min) * 0.15;
      const grow = adj.toLowerCase() === "steeper" || adj.toLowerCase() === "bigger";
      return nudgeParam(ctx, target, grow ? magnitude : -magnitude);
    },
  },
  {
    regex: /^\s*animate\s+(\w+)\s+from\s+(-?[\d.]+)\s+to\s+(-?[\d.]+)(?:\s+over\s+([\d.]+)\s*s(?:ec(?:onds)?)?)?\s*$/i,
    handle: (m, ctx) => {
      const [, name, fromStr, toStr, durStr] = m;
      return animateParam(ctx, name, Number(fromStr), Number(toStr), durStr ? Number(durStr) : 3);
    },
  },
  {
    regex: /^\s*(?:stop\s+animating|reset)\s+(\w+)\s*$/i,
    handle: (m, ctx) => {
      const [, name] = m;
      const id = ctx.ids.param(name);
      if (!ctx.graph.has(id)) return { ok: false, message: `No parameter named "${name}".` };
      const current = ctx.graph.get<number>(id);
      ctx.graph.set(id, current);
      ctx.graph.set(ctx.ids.track(name), undefined);
      return { ok: true, message: `Stopped animating ${name}` };
    },
  },
  {
    regex: /^\s*(play|pause)\s*$/i,
    handle: (m, ctx) => {
      const play = m[1].toLowerCase() === "play";
      ctx.setPlaying(play);
      return { ok: true, message: play ? "Playing" : "Paused" };
    },
  },
  {
    regex: /^\s*loop\s+(on|off)\s*$/i,
    handle: (m, ctx) => {
      const on = m[1].toLowerCase() === "on";
      ctx.setLoop(on);
      return { ok: true, message: `Loop ${on ? "on" : "off"}` };
    },
  },
  {
    regex: /^\s*speed\s+([\d.]+)\s*x?\s*$/i,
    handle: (m, ctx) => {
      ctx.setSpeed(Number(m[1]));
      return { ok: true, message: `Speed set to ${m[1]}x` };
    },
  },
  {
    regex: /^\s*(?:switch\s+to|use)\s+(exact|float)(?:\s+(?:mode|arithmetic))?\s*$/i,
    handle: (m, ctx) => {
      const mode = m[1].toLowerCase() as "float" | "exact";
      ctx.setMode(mode);
      return { ok: true, message: `Switched to ${mode} mode` };
    },
  },
  {
    regex: /^\s*(?:switch\s+to|use)\s+real(?:\s+numbers)?\s*$/i,
    handle: (_m, ctx) => {
      ctx.graph.set(ctx.ids.structure, null);
      return { ok: true, message: "Switched to real numbers" };
    },
  },
  {
    regex: /^\s*(?:switch\s+to|use)\s+(?:gf\s*\(\s*(\d+)\s*\)|z\s*\/\s*(\d+)\s*z)\s*$/i,
    handle: (m, ctx) => {
      const modulus = Number(m[1] ?? m[2]);
      ctx.graph.set(ctx.ids.structure, modulus);
      return { ok: true, message: `Switched to Z/${modulus}Z` };
    },
  },
];

/**
 * Resolves a chat message to a CellGraph operation, applying it immediately
 * and returning a confirmation/error message -- or null if `input` doesn't
 * match any known command phrasing (callers should show a "not understood,
 * try: ..." hint in that case).
 */
export function resolveChatCommand(input: string, ctx: ChatCommandContext): ChatCommandResult | null {
  for (const { regex, handle } of PATTERNS) {
    const match = input.match(regex);
    if (!match) continue;
    try {
      return handle(match, ctx);
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }
  return null;
}
