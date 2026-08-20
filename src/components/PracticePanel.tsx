import { Symbolic } from "mallory-math";
import { useEffect, useState } from "react";
import {
  checkDerivativeAnswer,
  generateDerivativeProblem,
  revealDerivative,
  type DerivativeProblem,
} from "../lib/derivative-practice.ts";
import {
  checkEquationAnswer,
  generateEquationProblem,
  revealRoots,
  type EquationProblem,
} from "../lib/equation-practice.ts";
import {
  checkAnswer,
  difficultyOf,
  pickRandomProblem,
  practiceableProblems,
  problemsForDifficulty,
  type AnswerCheckResult,
  type Difficulty,
  type RubiCorpus,
  type RubiProblem,
} from "../lib/integration-practice.ts";
import {
  checkMatrixDeterminantAnswer,
  generateMatrixDeterminantProblem,
  revealDeterminant,
  type MatrixDeterminantProblem,
} from "../lib/matrix-determinant-practice.ts";
import { TexSpan } from "./TexSpan.tsx";

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; problems: RubiProblem[] };

/**
 * Every practice mode this panel offers (issue #254's scoping pass): the
 * original antiderivative mode (a fixed 152-problem Rubi corpus), plus
 * three new randomly-generated modes chosen for reusing the most existing
 * mallory-math/matrix-ops infrastructure with the least new code --
 * `derivative` mirrors the antiderivative mode almost exactly (its inverse
 * operation), `equation` reuses `Symbolic.solve`/`verifySolution`
 * end-to-end, and `matrix-determinant` reuses `computeDeterminant` (the
 * same function `MatrixPanel.tsx` already calls). Broader expansion
 * (algebraic simplification, matrix inverse, geometry, probability/stats)
 * remains open future work -- see the individual lib files' own doc
 * comments for why these three were picked first.
 */
type Mode = "antiderivative" | "derivative" | "equation" | "matrix-determinant";

const MODE_LABELS: Record<Mode, string> = {
  antiderivative: "Antiderivatives",
  derivative: "Derivatives",
  equation: "Equations",
  "matrix-determinant": "Matrix determinants",
};
const MODES: Mode[] = ["antiderivative", "derivative", "equation", "matrix-determinant"];

/** A short-lived module-level cache of the fetched corpus -- switching tabs and back shouldn't refetch a static 328KB asset. */
let cachedProblems: RubiProblem[] | null = null;

function toLatexOrPlain(exprText: string): string {
  try {
    return Symbolic.toLatex(Symbolic.parse(exprText));
  } catch {
    return exprText;
  }
}

function resolveDifficulty(difficulty: Difficulty | "any"): Difficulty {
  if (difficulty !== "any") return difficulty;
  const bands: Difficulty[] = ["easy", "medium", "hard"];
  return bands[Math.floor(Math.random() * bands.length)] as Difficulty;
}

function MatrixTable({ m }: { m: number[][] }) {
  return (
    <table style={{ borderCollapse: "collapse", margin: "0.5rem 0" }}>
      <tbody>
        {m.map((row, i) => (
          <tr key={i}>
            {row.map((v, j) => (
              <td key={j} style={{ border: "1px solid var(--border)", padding: "2px 10px", textAlign: "right", fontFamily: "monospace" }}>
                {v}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Integration practice workbook (issue #39's item 1): draws a random
 * problem from mallory-math's Rubi-derived corpus, checks a typed
 * antiderivative via `checkAnswer` (numeric derivative agreement, robust to
 * additive constants and to writing an equivalent-but-different form -- see
 * its own doc comment), and can reveal the corpus's own answer. Streaks are
 * plain component state, not persisted across a reload -- a bounded v1
 * scope, not wired into CellGraph/localStorage.
 *
 * Issue #254 expanded this beyond antiderivatives: a `Mode` selector picks
 * between this original corpus-backed mode and three new randomly-generated
 * modes (derivatives, equation solving, matrix determinants), sharing the
 * same difficulty/streak/answer/reveal chrome.
 */
export function PracticePanel() {
  const [mode, setMode] = useState<Mode>("antiderivative");
  const [load, setLoad] = useState<LoadState>(() => (cachedProblems ? { status: "ready", problems: cachedProblems } : { status: "loading" }));
  const [difficulty, setDifficulty] = useState<Difficulty | "any">("any");
  const [problem, setProblem] = useState<RubiProblem | null>(null);
  const [derivativeProblem, setDerivativeProblem] = useState<DerivativeProblem | null>(null);
  const [equationProblem, setEquationProblem] = useState<EquationProblem | null>(null);
  const [matrixProblem, setMatrixProblem] = useState<MatrixDeterminantProblem | null>(null);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<AnswerCheckResult | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [streak, setStreak] = useState(0);

  useEffect(() => {
    if (cachedProblems) return;
    let cancelled = false;
    fetch("/rubi-corpus.json")
      .then((r) => {
        if (!r.ok) throw new Error(`Fetch failed: ${r.status} ${r.statusText}`);
        return r.json() as Promise<RubiCorpus>;
      })
      .then((corpus) => {
        if (cancelled) return;
        const problems = practiceableProblems(corpus);
        cachedProblems = problems;
        setLoad({ status: "ready", problems });
      })
      .catch((e) => {
        if (!cancelled) setLoad({ status: "error", message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function newProblem(nextMode: Mode, nextDifficulty: Difficulty | "any") {
    setAnswer("");
    setResult(null);
    setRevealed(false);
    if (nextMode === "antiderivative") {
      if (load.status !== "ready") return;
      setProblem(pickRandomProblem(problemsForDifficulty(load.problems, nextDifficulty)));
      return;
    }
    const concrete = resolveDifficulty(nextDifficulty);
    if (nextMode === "derivative") setDerivativeProblem(generateDerivativeProblem(concrete));
    if (nextMode === "equation") setEquationProblem(generateEquationProblem(concrete));
    if (nextMode === "matrix-determinant") setMatrixProblem(generateMatrixDeterminantProblem(concrete));
  }

  useEffect(() => {
    if (load.status === "ready" && mode === "antiderivative" && !problem) newProblem("antiderivative", difficulty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, mode]);

  function handleModeChange(next: Mode) {
    setMode(next);
    newProblem(next, difficulty);
  }

  function handleDifficultyChange(next: Difficulty | "any") {
    setDifficulty(next);
    newProblem(mode, next);
  }

  function handleCheck() {
    let outcome: AnswerCheckResult | null = null;
    if (mode === "antiderivative" && problem) outcome = checkAnswer(problem, answer);
    if (mode === "derivative" && derivativeProblem) outcome = checkDerivativeAnswer(derivativeProblem, answer);
    if (mode === "equation" && equationProblem) outcome = checkEquationAnswer(equationProblem, answer);
    if (mode === "matrix-determinant" && matrixProblem) outcome = checkMatrixDeterminantAnswer(matrixProblem, answer);
    if (!outcome) return;
    setResult(outcome);
    setStreak((s) => (outcome!.correct ? s + 1 : 0));
  }

  const modeRow = (
    <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
      {MODES.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => handleModeChange(m)}
          aria-pressed={mode === m}
          style={{ fontWeight: mode === m ? 700 : 400, background: mode === m ? "var(--accent-bg, #eef2ff)" : undefined }}
        >
          {MODE_LABELS[m]}
        </button>
      ))}
    </div>
  );

  const controlsRow = (
    <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
      <label>
        Difficulty:{" "}
        <select value={difficulty} onChange={(e) => handleDifficultyChange(e.target.value as Difficulty | "any")}>
          <option value="any">Any</option>
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </select>
      </label>
      <span title="Consecutive correct answers. Resets to 0 on a wrong answer; switching modes/difficulty, skipping to a new problem, or revealing the answer leaves it untouched. Not saved -- leaving the page starts over.">
        Streak: <strong>{streak}</strong>
      </span>
      <button type="button" onClick={() => newProblem(mode, difficulty)}>
        New problem
      </button>
    </div>
  );

  if (mode === "antiderivative") {
    if (load.status === "loading") {
      return (
        <div>
          {modeRow}
          <p>Loading the practice corpus…</p>
        </div>
      );
    }
    if (load.status === "error") {
      return (
        <div>
          {modeRow}
          <p style={{ color: "var(--danger)" }}>Failed to load the practice corpus: {load.message}</p>
        </div>
      );
    }
    return (
      <div>
        {modeRow}
        {controlsRow}
        {problem && (
          <>
            <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>
              {difficultyOf(problem)} · {problem.steps} rule{problem.steps === 1 ? "" : "s"} to solve
            </p>
            <p style={{ margin: "0.5rem 0" }}>
              Find <TexSpan tex={`\\int ${toLatexOrPlain(problem.integrand)} \\, d${problem.variable}`} />
            </p>
            <div style={{ margin: "0.25rem 0" }}>
              <label>
                Your answer:{" "}
                <input value={answer} onChange={(e) => setAnswer(e.target.value)} style={{ font: "inherit", width: "28ch" }} />
              </label>{" "}
              <button type="button" onClick={handleCheck}>
                Check
              </button>{" "}
              <button type="button" onClick={() => setRevealed(true)}>
                Show me
              </button>
            </div>
            {result && <p style={{ color: result.correct ? "#16a34a" : "var(--danger)", margin: "0.25rem 0" }}>{result.message}</p>}
            {revealed && (
              <p style={{ margin: "0.25rem 0" }}>
                Answer: <TexSpan tex={toLatexOrPlain(problem.antiderivative)} />{" "}
                <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>(+ C)</span>
              </p>
            )}
          </>
        )}
      </div>
    );
  }

  if (mode === "derivative") {
    return (
      <div>
        {modeRow}
        {controlsRow}
        {derivativeProblem && (
          <>
            <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>{derivativeProblem.difficulty}</p>
            <p style={{ margin: "0.5rem 0" }}>
              Find <TexSpan tex={`\\frac{d}{dx}\\left[${toLatexOrPlain(derivativeProblem.expression)}\\right]`} />
            </p>
            <div style={{ margin: "0.25rem 0" }}>
              <label>
                Your answer:{" "}
                <input value={answer} onChange={(e) => setAnswer(e.target.value)} style={{ font: "inherit", width: "28ch" }} />
              </label>{" "}
              <button type="button" onClick={handleCheck}>
                Check
              </button>{" "}
              <button type="button" onClick={() => setRevealed(true)}>
                Show me
              </button>
            </div>
            {result && <p style={{ color: result.correct ? "#16a34a" : "var(--danger)", margin: "0.25rem 0" }}>{result.message}</p>}
            {revealed && (
              <p style={{ margin: "0.25rem 0" }}>
                Answer: <TexSpan tex={toLatexOrPlain(revealDerivative(derivativeProblem))} />
              </p>
            )}
          </>
        )}
      </div>
    );
  }

  if (mode === "equation") {
    return (
      <div>
        {modeRow}
        {controlsRow}
        {equationProblem && (
          <>
            <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>{equationProblem.difficulty}</p>
            <p style={{ margin: "0.5rem 0" }}>
              Solve <TexSpan tex={`${toLatexOrPlain(equationProblem.equationText)} = 0`} /> for {equationProblem.variable} (list every real root,
              comma-separated)
            </p>
            <div style={{ margin: "0.25rem 0" }}>
              <label>
                Your answer:{" "}
                <input value={answer} onChange={(e) => setAnswer(e.target.value)} style={{ font: "inherit", width: "28ch" }} />
              </label>{" "}
              <button type="button" onClick={handleCheck}>
                Check
              </button>{" "}
              <button type="button" onClick={() => setRevealed(true)}>
                Show me
              </button>
            </div>
            {result && <p style={{ color: result.correct ? "#16a34a" : "var(--danger)", margin: "0.25rem 0" }}>{result.message}</p>}
            {revealed && <p style={{ margin: "0.25rem 0" }}>Answer: {revealRoots(equationProblem)}</p>}
          </>
        )}
      </div>
    );
  }

  // mode === "matrix-determinant"
  return (
    <div>
      {modeRow}
      {controlsRow}
      {matrixProblem && (
        <>
          <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>{matrixProblem.difficulty}</p>
          <p style={{ margin: "0.5rem 0" }}>Find the determinant of:</p>
          <MatrixTable m={matrixProblem.matrix} />
          <div style={{ margin: "0.25rem 0" }}>
            <label>
              Your answer:{" "}
              <input value={answer} onChange={(e) => setAnswer(e.target.value)} style={{ font: "inherit", width: "14ch" }} />
            </label>{" "}
            <button type="button" onClick={handleCheck}>
              Check
            </button>{" "}
            <button type="button" onClick={() => setRevealed(true)}>
              Show me
            </button>
          </div>
          {result && <p style={{ color: result.correct ? "#16a34a" : "var(--danger)", margin: "0.25rem 0" }}>{result.message}</p>}
          {revealed && <p style={{ margin: "0.25rem 0" }}>Answer: {revealDeterminant(matrixProblem)}</p>}
        </>
      )}
    </div>
  );
}
