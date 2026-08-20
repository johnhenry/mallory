import { type FormEvent, useEffect, useRef, useState } from "react";
import { CellGraph } from "../lib/cell-graph.ts";
import { cayleyTableCanvasSize, drawCayleyTable } from "../lib/cayley-table-render.ts";
import { cellIdsDiscrete, type CellIdsDiscrete } from "../lib/cell-ids.ts";
import { resolveDiscreteChatCommand } from "../lib/discrete-chat-commands.ts";
import {
  buildGroupInfo,
  factorizeForPanel,
  solveCrt,
  tracedGcd,
  type CrtResult,
  type FactorizationResult,
  type GroupInfo,
  type GroupKind,
  type TracedGcd,
} from "../lib/discrete-math.ts";
import { DEFAULT_DISCRETE_STATE, decodeDiscreteState, encodeDiscreteState, type DiscreteState } from "../lib/discrete-state.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useCell } from "../lib/use-cell.ts";
import { PngExportButton } from "./PngExportButton.tsx";

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

function seedDiscreteState(graph: CellGraph, ids: CellIdsDiscrete, state: DiscreteState): void {
  graph.set(ids.groupKind, state.groupKind);
  graph.set(ids.groupN, state.groupN);
  graph.set(ids.gcdA, state.gcdA);
  graph.set(ids.gcdB, state.gcdB);
  graph.set(ids.factorizeN, state.factorizeN);
  graph.set(ids.crtText, state.crtText);
}

function getCurrentDiscreteState(graph: CellGraph, ids: CellIdsDiscrete): DiscreteState {
  return {
    v: 1,
    groupKind: graph.get<GroupKind>(ids.groupKind),
    groupN: graph.get<string>(ids.groupN),
    gcdA: graph.get<string>(ids.gcdA),
    gcdB: graph.get<string>(ids.gcdB),
    factorizeN: graph.get<string>(ids.factorizeN),
    crtText: graph.get<string>(ids.crtText),
  };
}

/** Parses "remainder, modulus" pairs, one per line, for the CRT solver. */
function parseCrtText(text: string): { remainders: bigint[]; moduli: bigint[] } {
  const lines = text
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const remainders: bigint[] = [];
  const moduli: bigint[] = [];
  for (const line of lines) {
    const parts = line.split(/[\s,]+/).filter(Boolean);
    if (parts.length !== 2) throw new Error(`Each line needs exactly "remainder, modulus" -- got "${line}".`);
    remainders.push(BigInt(parts[0] as string));
    moduli.push(BigInt(parts[1] as string));
  }
  return { remainders, moduli };
}

function useDiscreteGraph(cellId: string): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = new CellGraph();
    const ids = cellIdsDiscrete(cellId);
    const decoded = typeof window !== "undefined" ? decodeDiscreteState(window.location.hash.slice(1)) : null;
    seedDiscreteState(graph, ids, decoded ?? DEFAULT_DISCRETE_STATE);

    graph.define(ids.groupInfo, (): Result<GroupInfo> => {
      try {
        const kind = graph.get<GroupKind>(ids.groupKind);
        const n = Number(graph.get<string>(ids.groupN));
        return { ok: true, value: buildGroupInfo(kind, n) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    graph.define(ids.gcdResult, (): Result<TracedGcd> => {
      try {
        const a = BigInt(graph.get<string>(ids.gcdA));
        const b = BigInt(graph.get<string>(ids.gcdB));
        return { ok: true, value: tracedGcd(a, b) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    graph.define(ids.factorizeResult, (): Result<FactorizationResult> => {
      try {
        const n = BigInt(graph.get<string>(ids.factorizeN));
        return { ok: true, value: factorizeForPanel(n) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    graph.define(ids.crtResult, (): Result<CrtResult | { ok: false; message: string }> => {
      try {
        const { remainders, moduli } = parseCrtText(graph.get<string>(ids.crtText));
        return { ok: true, value: solveCrt(remainders, moduli) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    ref.current = graph;
  }
  return ref.current;
}

function CayleyTable({ info }: { info: GroupInfo }) {
  return (
    <table style={{ borderCollapse: "collapse", fontFamily: "monospace", fontSize: "0.85rem" }}>
      <tbody>
        <tr>
          <td style={{ border: "1px solid var(--border)", padding: "2px 6px" }} />
          {info.labels.map((l, j) => (
            <td key={j} style={{ border: "1px solid var(--border)", padding: "2px 6px", fontWeight: 600 }}>
              {l}
            </td>
          ))}
        </tr>
        {info.table.map((row, i) => (
          <tr key={i}>
            <td style={{ border: "1px solid var(--border)", padding: "2px 6px", fontWeight: 600 }}>{info.labels[i]}</td>
            {row.map((cellIdx, j) => (
              <td
                key={j}
                style={{
                  border: "1px solid var(--border)",
                  padding: "2px 6px",
                  background: cellIdx === info.identityIndex ? "#dcfce7" : undefined,
                }}
              >
                {info.labels[cellIdx]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Cayley tables + group axiom badges for Zn/Sn, and a number-theory toolbox (traced gcd, factorization, CRT solver). */
export function DiscretePanel({ cellId = "discrete-1" }: { cellId?: string } = {}) {
  const graph = useDiscreteGraph(cellId);
  useCellGraphTools(`data_discrete_${cellId}`, graph);
  const ids = cellIdsDiscrete(cellId);
  const cayleyCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const groupKind = useCell<GroupKind>(graph, ids.groupKind);
  const groupN = useCell<string>(graph, ids.groupN);
  const groupInfo = useCell<Result<GroupInfo>>(graph, ids.groupInfo);
  const gcdA = useCell<string>(graph, ids.gcdA);
  const gcdB = useCell<string>(graph, ids.gcdB);
  const gcdResult = useCell<Result<TracedGcd>>(graph, ids.gcdResult);
  const factorizeN = useCell<string>(graph, ids.factorizeN);
  const factorizeResult = useCell<Result<FactorizationResult>>(graph, ids.factorizeResult);
  const crtText = useCell<string>(graph, ids.crtText);
  const crtResult = useCell<Result<CrtResult | { ok: false; message: string }>>(graph, ids.crtResult);

  // DiscretePanel's first chat-command surface (#339, mirroring MatrixPanel's
  // identically-shaped one from issue #46 item 1): contextual commands like
  // "is this a group" that read whatever's already entered, rather than the
  // literal-bearing phrasings nl-query-discrete.ts's
  // resolveDiscreteNavigationCommand handles from a DIFFERENT panel's chat
  // box. resolveDiscreteChatCommand only ever reads the graph, so there's no
  // setter bundle to pass through, same as MatrixPanel's.
  const [chatInput, setChatInput] = useState("");
  const [chatLog, setChatLog] = useState<Array<{ input: string; ok: boolean; message: string }>>([]);
  function handleChatSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = chatInput.trim();
    if (!input) return;
    const result = resolveDiscreteChatCommand(input, { graph, ids });
    setChatLog((log) => [
      ...log,
      {
        input,
        ok: result?.ok ?? false,
        message: result?.message ?? `Didn't understand that. Try "is this a group", "gcd of this", "factor this", or "crt result".`,
      },
    ]);
    setChatInput("");
  }

  useEffect(() => {
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeDiscreteState(getCurrentDiscreteState(graph, ids))}`);
    }
    writeUrl();
    return graph.subscribeAll(writeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  // Keeps a hidden canvas mirror of the visible HTML <CayleyTable> in sync,
  // purely so PngExportButton has a <canvas> to hand to canvas.toBlob() --
  // an HTML <table> has no such thing (issue #45 item 3). Sized fresh each
  // draw since the table's dimensions change with the group's order (n).
  useEffect(() => {
    const canvas = cayleyCanvasRef.current;
    if (!canvas || !groupInfo.ok) return;
    const { width, height } = cayleyTableCanvasSize(groupInfo.value);
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawCayleyTable(ctx, groupInfo.value);
  }, [groupInfo]);

  return (
    <div>
      <h2>Group (Cayley table)</h2>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <label>
          <select value={groupKind} onChange={(e) => graph.set(ids.groupKind, e.target.value as GroupKind)}>
            <option value="cyclic">Zn (cyclic, addition)</option>
            <option value="symmetric">Sn (symmetric)</option>
          </select>
        </label>
        <label>
          n:{" "}
          <input
            type="number"
            min={1}
            value={groupN}
            onChange={(e) => graph.set(ids.groupN, e.target.value)}
            style={{ font: "inherit", width: "6ch" }}
          />
        </label>
      </div>
      {groupInfo.ok ? (
        <div>
          <p>
            {groupInfo.value.isGroup ? "✓ group" : "✗ not a group"}
            {groupInfo.value.isGroup && (groupInfo.value.isAbelian ? ", abelian" : ", non-abelian")}
            {groupInfo.value.identityIndex !== null && `, identity = ${groupInfo.value.labels[groupInfo.value.identityIndex]}`}
          </p>
          <div style={{ overflowX: "auto" }}>
            <CayleyTable info={groupInfo.value} />
          </div>
          <canvas ref={cayleyCanvasRef} style={{ display: "none" }} />
          <div style={{ margin: "0.25rem 0" }}>
            <PngExportButton
              getCanvas={() => cayleyCanvasRef.current}
              label="cayley-table"
              renderAtScale={
                groupInfo.ok
                  ? (ctx, width) => drawCayleyTable(ctx, groupInfo.value, width / (groupInfo.value.labels.length + 1))
                  : undefined
              }
              baseWidth={groupInfo.ok ? cayleyTableCanvasSize(groupInfo.value).width : undefined}
              baseHeight={groupInfo.ok ? cayleyTableCanvasSize(groupInfo.value).height : undefined}
            />
          </div>
        </div>
      ) : (
        <p style={{ color: "var(--danger)" }}>{groupInfo.message}</p>
      )}

      <h2>Number theory</h2>
      <h3>Euclidean algorithm (gcd)</h3>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <label>
          a: <input value={gcdA} onChange={(e) => graph.set(ids.gcdA, e.target.value)} style={{ font: "inherit", width: "10ch" }} />
        </label>
        <label>
          b: <input value={gcdB} onChange={(e) => graph.set(ids.gcdB, e.target.value)} style={{ font: "inherit", width: "10ch" }} />
        </label>
      </div>
      {gcdResult.ok ? (
        <div>
          <ol>
            {gcdResult.value.steps.map((step, i) => (
              <li key={i}>
                {step.a.toString()} = {step.q.toString()} × {step.b.toString()} + {step.r.toString()}
              </li>
            ))}
          </ol>
          <p>gcd = {gcdResult.value.gcd.toString()}</p>
        </div>
      ) : (
        <p style={{ color: "var(--danger)" }}>{gcdResult.message}</p>
      )}

      <h3>Factorization</h3>
      <div style={{ margin: "0.25rem 0" }}>
        <input value={factorizeN} onChange={(e) => graph.set(ids.factorizeN, e.target.value)} style={{ font: "inherit", width: "16ch" }} />
      </div>
      {factorizeResult.ok ? (
        <p>
          {factorizeResult.value.isPrime
            ? `${factorizeN} is prime.`
            : factorizeResult.value.factors.map(([p, e]) => (e === 1 ? p.toString() : `${p}^${e}`)).join(" × ")}
        </p>
      ) : (
        <p style={{ color: "var(--danger)" }}>{factorizeResult.message}</p>
      )}

      <h3>Chinese Remainder Theorem</h3>
      <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>One "remainder, modulus" pair per line.</p>
      <div style={{ margin: "0.25rem 0" }}>
        <textarea
          value={crtText}
          onChange={(e) => graph.set(ids.crtText, e.target.value)}
          rows={3}
          style={{ font: "inherit", fontFamily: "monospace", width: "20ch" }}
        />
      </div>
      {crtResult.ok ? (
        crtResult.value.ok ? (
          <p>
            x ≡ {crtResult.value.x.toString()} (mod {crtResult.value.modulus.toString()})
          </p>
        ) : (
          <p style={{ color: "var(--danger)" }}>{crtResult.value.message}</p>
        )
      ) : (
        <p style={{ color: "var(--danger)" }}>{crtResult.message}</p>
      )}

      <form onSubmit={handleChatSubmit} style={{ margin: "0.5rem 0" }}>
        <label title="A fixed set of command phrasings, not free-text chat -- the placeholder shows the shapes it understands.">
          Commands:{" "}
          <input
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder='"is this a group", "gcd of this", "factor this"...'
            style={{ font: "inherit", width: "32ch" }}
          />
        </label>{" "}
        <button type="submit">Run</button>
        {chatLog.length > 0 && (
          <ul style={{ fontSize: "0.85rem", listStyle: "none", padding: 0, margin: "0.25rem 0" }}>
            {chatLog.slice(-5).map((entry, i) => (
              <li key={i} style={{ color: entry.ok ? "inherit" : "var(--danger)" }}>
                <strong>{entry.input}</strong> — {entry.message}
              </li>
            ))}
          </ul>
        )}
      </form>
    </div>
  );
}
