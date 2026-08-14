import { Symbolic } from "mallory-math";
import { useEffect, useState } from "react";
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
import { TexSpan } from "./TexSpan.tsx";

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; problems: RubiProblem[] };

/** A short-lived module-level cache of the fetched corpus -- switching tabs and back shouldn't refetch a static 328KB asset. */
let cachedProblems: RubiProblem[] | null = null;

function toLatexOrPlain(exprText: string): string {
  try {
    return Symbolic.toLatex(Symbolic.parse(exprText));
  } catch {
    return exprText;
  }
}

/**
 * Integration practice workbook (issue #39's item 1): draws a random
 * problem from mallory-math's Rubi-derived corpus, checks a typed
 * antiderivative via `checkAnswer` (numeric derivative agreement, robust to
 * additive constants and to writing an equivalent-but-different form -- see
 * its own doc comment), and can reveal the corpus's own answer. Streaks are
 * plain component state, not persisted across a reload -- a bounded v1
 * scope, not wired into CellGraph/localStorage.
 */
export function PracticePanel() {
  const [load, setLoad] = useState<LoadState>(() => (cachedProblems ? { status: "ready", problems: cachedProblems } : { status: "loading" }));
  const [difficulty, setDifficulty] = useState<Difficulty | "any">("any");
  const [problem, setProblem] = useState<RubiProblem | null>(null);
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

  function nextProblem(pool: RubiProblem[], nextDifficulty: Difficulty | "any") {
    const picked = pickRandomProblem(problemsForDifficulty(pool, nextDifficulty));
    setProblem(picked);
    setAnswer("");
    setResult(null);
    setRevealed(false);
  }

  useEffect(() => {
    if (load.status === "ready" && !problem) nextProblem(load.problems, difficulty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  function handleDifficultyChange(next: Difficulty | "any") {
    setDifficulty(next);
    if (load.status === "ready") nextProblem(load.problems, next);
  }

  function handleCheck() {
    if (!problem) return;
    const outcome = checkAnswer(problem, answer);
    setResult(outcome);
    setStreak((s) => (outcome.correct ? s + 1 : 0));
  }

  if (load.status === "loading") return <p>Loading the practice corpus…</p>;
  if (load.status === "error") return <p style={{ color: "var(--danger)" }}>Failed to load the practice corpus: {load.message}</p>;

  return (
    <div>
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
        <span>
          Streak: <strong>{streak}</strong>
        </span>
        <button type="button" onClick={() => nextProblem(load.problems, difficulty)}>
          New problem
        </button>
      </div>

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
          {result && (
            <p style={{ color: result.correct ? "#16a34a" : "var(--danger)", margin: "0.25rem 0" }}>{result.message}</p>
          )}
          {revealed && (
            <p style={{ margin: "0.25rem 0" }}>
              Answer: <TexSpan tex={toLatexOrPlain(problem.antiderivative)} /> {" "}
              <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>(+ C)</span>
            </p>
          )}
        </>
      )}
    </div>
  );
}
