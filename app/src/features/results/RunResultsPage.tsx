import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../../shared/auth/AuthContext";
import { runsApi } from "../../shared/api/runs";
import { ApiError } from "../../shared/api/client";
import { StatusTag } from "../../shared/components/StatusTag";
import type {
  Generation,
  RunProgress,
  RunResults,
  RunSummary,
  StrategyProgress,
} from "../../shared/types/run";

interface ScoredGeneration extends Generation {
  behavior: string;
}

function topAttacks(results: RunResults | null): ScoredGeneration[] {
  if (!results?.generations) return [];
  const scored: ScoredGeneration[] = [];
  for (const [behavior, gens] of Object.entries(results.generations)) {
    for (const g of gens) {
      if (g.score !== null) scored.push({ ...g, behavior });
    }
  }
  return scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 5);
}

function averageGenerationScore(results: RunResults | null): number | null {
  if (!results) return null;
  const scores: number[] = [];
  for (const gens of Object.values(results.generations ?? {})) {
    for (const g of gens) if (g.score !== null) scores.push(g.score);
  }
  if (scores.length > 0) return scores.reduce((a, b) => a + b, 0) / scores.length;

  // No evaluate generations — fall back to the mean of the phase averages.
  const phaseAvgs = Object.values(results.phases).map((p) => p.average_score);
  if (phaseAvgs.length === 0) return null;
  return phaseAvgs.reduce((a, b) => a + b, 0) / phaseAvgs.length;
}

export function RunResultsPage() {
  const { id = "" } = useParams();
  const { token } = useAuth();
  const [run, setRun] = useState<RunSummary | null>(null);
  const [results, setResults] = useState<RunResults | null>(null);
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    Promise.all([
      runsApi.get(token, id),
      runsApi.results(token, id),
      runsApi.progress(token, id).catch(() => null),
    ])
      .then(([r, res, prog]) => {
        if (cancelled) return;
        setRun(r);
        setResults(res);
        setProgress(prog);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? err.message
              : "couldn't reach the server — check the gateway is running",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, id]);

  const attacks = useMemo(() => topAttacks(results), [results]);
  const avgScore = useMemo(() => averageGenerationScore(results), [results]);

  const strategies = progress?.strategies ?? [];
  const discovered = progress?.discovered_this_run ?? strategies.length;
  const mostEffective = useMemo<StrategyProgress | null>(
    () =>
      strategies.length === 0
        ? null
        : strategies.reduce((best, s) => (s.average_score > best.average_score ? s : best)),
    [strategies],
  );
  const mostFrequent = useMemo(
    () => [...strategies].sort((a, b) => b.usage_count - a.usage_count).slice(0, 5),
    [strategies],
  );

  return (
    <main style={{ flex: 1, overflowY: "auto" }}>
      <div style={{ maxWidth: 820, margin: "0 auto", padding: "var(--space-8) var(--space-4)" }}>
        <Link to="/results" className="text-muted">
          ← Back to tests
        </Link>
        <h1 style={{ marginTop: "var(--space-3)" }}>{run?.model_name ?? "Run results"}</h1>
        {run && (
          <p style={{ marginBottom: "var(--space-6)" }}>
            <StatusTag status={run.status} metrics={results?.metrics} />
          </p>
        )}

        {error && <div className="form-error">{error}</div>}
        {!error && !results && <p className="spinner-text">Loading…</p>}

        {results && (
          <>
            <div className="metrics-grid" style={{ marginBottom: "var(--space-6)" }}>
              <div>
                <div className="metric-value">{avgScore !== null ? avgScore.toFixed(2) : "—"}</div>
                <div className="metric-label">Average score</div>
              </div>
              <div>
                <div className="metric-value">{discovered}</div>
                <div className="metric-label">Strategies discovered</div>
              </div>
              {results.metrics && (
                <div>
                  <div className="metric-value">{(results.metrics.asr * 100).toFixed(0)}%</div>
                  <div className="metric-label">Attack success</div>
                </div>
              )}
            </div>

            <h2>Most effective attack prompts</h2>
            {attacks.length === 0 ? (
              <p className="empty-state">
                No scored generations — this run had no evaluate phase.
              </p>
            ) : (
              attacks.map((g, i) => (
                <div key={i} className="transcript-item">
                  <div className="transcript-label">
                    {g.behavior} — score {g.score?.toFixed(2)}
                  </div>
                  <div className="transcript-text">{g.attack_prompt}</div>
                  <div className="transcript-label" style={{ marginTop: "var(--space-2)" }}>
                    Target response
                  </div>
                  <div className="transcript-text">{g.target_response}</div>
                </div>
              ))
            )}

            <div className="hr" style={{ margin: "var(--space-6) 0" }} />

            <h2>Strategies discovered</h2>
            {strategies.length === 0 ? (
              <p className="empty-state">No strategies in this target's library yet.</p>
            ) : (
              <>
                {mostEffective && (
                  <>
                    <div className="card-kicker" style={{ marginBottom: "var(--space-2)" }}>
                      Most effective — {mostEffective.name} (avg{" "}
                      {mostEffective.average_score.toFixed(2)})
                    </div>
                    <div className="transcript-item">
                      <div className="transcript-label">Attack Pi (weaker attempt)</div>
                      <div className="transcript-text">{mostEffective.example_prompt_pi}</div>
                      <div className="transcript-label" style={{ marginTop: "var(--space-2)" }}>
                        Attack Pj (stronger attempt)
                      </div>
                      <div className="transcript-text">{mostEffective.example_prompt_pj}</div>
                    </div>
                  </>
                )}

                <h3 style={{ marginTop: "var(--space-5)" }}>Most frequent strategies</h3>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Strategy</th>
                      <th>Category</th>
                      <th>Uses</th>
                      <th>Avg score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mostFrequent.map((s) => (
                      <tr key={s.strategy_id}>
                        <td>{s.name}</td>
                        <td className="text-muted">{s.category}</td>
                        <td>{s.usage_count}</td>
                        <td>{s.average_score.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
