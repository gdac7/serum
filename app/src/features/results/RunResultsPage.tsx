import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../shared/auth/AuthContext";
import { runsApi } from "../../shared/api/runs";
import { ApiError } from "../../shared/api/client";
import { StatusTag } from "../../shared/components/StatusTag";
import type {
  RunProgress,
  RunResults,
  RunSummary,
  StrategyProgress,
} from "../../shared/types/run";

const PHASE_ORDER = ["warmup", "lifelong", "evaluate"];
const PHASE_LABEL: Record<string, string> = {
  warmup: "Warm-up",
  lifelong: "Lifelong",
  evaluate: "Evaluate",
};

function orderedPhases(results: RunResults | null): [string, RunResults["phases"][string]][] {
  if (!results) return [];
  return Object.entries(results.phases).sort(
    (a, b) => PHASE_ORDER.indexOf(a[0]) - PHASE_ORDER.indexOf(b[0]),
  );
}

export function RunResultsPage() {
  const { id = "" } = useParams();
  const { token } = useAuth();
  const navigate = useNavigate();
  const [run, setRun] = useState<RunSummary | null>(null);
  const [results, setResults] = useState<RunResults | null>(null);
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);

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

  const phases = useMemo(() => orderedPhases(results), [results]);

  const strategies = progress?.strategies ?? [];
  const discovered = progress?.discovered_this_run ?? strategies.length;

  // The library holds one row per (strategy, context), so the same strategy
  // name recurs. Collapse by name: uses summed, score = usage-weighted mean
  // (the average across every prompt that used the strategy), and keep the
  // best-scoring context as the illustrative Pi/Pj example. Both the "most
  // effective" and "most frequent" views read from this, so their scores agree.
  const grouped = useMemo(() => {
    const byName = new Map<
      string,
      {
        name: string;
        category: string;
        usage_count: number;
        score_sum: number;
        example: StrategyProgress;
      }
    >();
    for (const s of strategies) {
      const agg = byName.get(s.name);
      if (!agg) {
        byName.set(s.name, {
          name: s.name,
          category: s.category,
          usage_count: s.usage_count,
          score_sum: s.average_score * s.usage_count,
          example: s,
        });
      } else {
        agg.usage_count += s.usage_count;
        agg.score_sum += s.average_score * s.usage_count;
        if (s.average_score > agg.example.average_score) agg.example = s;
      }
    }
    return [...byName.values()].map((a) => ({
      name: a.name,
      category: a.category,
      usage_count: a.usage_count,
      average_score: a.usage_count > 0 ? a.score_sum / a.usage_count : 0,
      example: a.example,
    }));
  }, [strategies]);

  const mostEffective = useMemo(
    () =>
      grouped.length === 0
        ? null
        : grouped.reduce((best, s) => (s.average_score > best.average_score ? s : best)),
    [grouped],
  );
  const mostFrequent = useMemo(
    () => [...grouped].sort((a, b) => b.usage_count - a.usage_count).slice(0, 5),
    [grouped],
  );
  const selected = grouped.find((s) => s.name === selectedName) ?? mostEffective;

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
            <h2 style={{ textAlign: "center" }}>Attack prompts</h2>
            {results.metrics && (
              <div className="metrics-grid" style={{ marginBottom: "var(--space-6)" }}>
                <div>
                  <div className="metric-value">{(results.metrics.asr * 100).toFixed(0)}%</div>
                  <div className="metric-label">Attack success</div>
                </div>
              </div>
            )}

            {phases.length === 0 ? (
              <p className="empty-state">No phase summaries for this run.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Phase</th>
                    <th>Avg score</th>
                    <th>Attacks</th>
                    <th>Successful</th>
                  </tr>
                </thead>
                <tbody>
                  {phases.map(([name, p]) => (
                    <tr key={name}>
                      <td>{PHASE_LABEL[name] ?? name}</td>
                      <td>{p.average_score.toFixed(2)}</td>
                      <td>{p.total_attacks}</td>
                      <td>{p.successful_attacks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}


            <button
              type="button"
              className="btn btn-secondary"
              style={{ marginTop: "var(--space-3)" }}
              onClick={() => navigate(`/results/${id}/transcript`)}
            >
              Show attack prompts and target responses
            </button>

            <h2 style={{ textAlign: "center", marginTop: "var(--space-8)" }}>Strategies</h2>
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                textAlign: "center",
                marginBottom: "var(--space-6)",
              }}
            >
              <div>
                <div className="metric-value">{discovered}</div>
                <div className="metric-label">Strategies discovered</div>
              </div>
            </div>
            {strategies.length === 0 ? (
              <p className="empty-state">No strategies in this target's library yet.</p>
            ) : (
              <>
                {selected && (
                  <>
                    <div className="field">
                      <label>Strategy example</label>
                      <select
                        className="input"
                        value={selected.name}
                        onChange={(e) => setSelectedName(e.target.value)}
                      >
                        {grouped.map((s) => (
                          <option key={s.name} value={s.name}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="transcript-item">
                      <div className="transcript-label">Malicious request</div>
                      <div className="transcript-text" style={{ marginBottom: "var(--space-3)" }}>
                        {selected.example.malicious_request || (
                          <span className="text-muted">
                            not recorded — discovered before the request was tracked
                          </span>
                        )}
                      </div>
                      <div className="transcript-label">Weaker attempt</div>
                      <div className="transcript-text">{selected.example.example_prompt_pi}</div>
                      <div
                        style={{
                          textAlign: "center",
                          margin: "var(--space-3) 0",
                          opacity: 0.8,
                        }}
                      >
                        <div style={{ fontSize: 22, lineHeight: 1 }}>↓</div>
                        <div className="card-kicker">apply strategy: {selected.name}</div>
                        <div style={{ fontSize: 22, lineHeight: 1 }}>↓</div>
                      </div>
                      <div className="transcript-label">Stronger attempt</div>
                      <div className="transcript-text">{selected.example.example_prompt_pj}</div>
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
                      <tr key={s.name}>
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
