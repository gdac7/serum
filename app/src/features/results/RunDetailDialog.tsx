import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../shared/auth/AuthContext";
import { runsApi } from "../../shared/api/runs";
import { ApiError } from "../../shared/api/client";
import { StatusTag } from "../../shared/components/StatusTag";
import type { RunResults, RunSummary } from "../../shared/types/run";

export function RunDetailDialog({ runId, onClose }: { runId: string; onClose: () => void }) {
  const { token } = useAuth();
  const [run, setRun] = useState<RunSummary | null>(null);
  const [results, setResults] = useState<RunResults | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    runsApi
      .get(token, runId)
      .then((r) => {
        if (cancelled) return;
        setRun(r);
        if (r.status === "completed") {
          return runsApi.results(token, runId).then((res) => {
            if (!cancelled) setResults(res);
          });
        }
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
  }, [token, runId]);

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog dialog-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="test-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-title" id="test-title">
          {run?.model_name ?? "Run"}
        </div>

        <div className="dialog-body dialog-scroll">
          {error && <div className="form-error">{error}</div>}
          {!error && !run && <p className="spinner-text">Loading…</p>}

          {run && (
            <>
              <p style={{ margin: "0 0 var(--space-3)" }}>
                <StatusTag status={run.status} metrics={results?.metrics} />
              </p>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "var(--space-3)",
                  fontSize: 14,
                }}
              >
                <div>
                  <div className="card-kicker">Target kind</div>
                  {run.target_kind}
                </div>
                <div>
                  <div className="card-kicker">Phases</div>
                  {run.phases.join(", ")}
                </div>
                <div>
                  <div className="card-kicker">Dataset</div>
                  {run.standard_dataset
                    ? `${run.standard_dataset} · ${run.standard_dataset_percent}%`
                    : `${run.dataset.length} request${run.dataset.length === 1 ? "" : "s"}`}
                </div>
                <div>
                  <div className="card-kicker">Created</div>
                  {new Date(run.created_at).toLocaleString()}
                </div>
                <div>
                  <div className="card-kicker">Started</div>
                  {run.started_at ? new Date(run.started_at).toLocaleString() : "—"}
                </div>
                <div>
                  <div className="card-kicker">Ended</div>
                  {run.ended_at ? new Date(run.ended_at).toLocaleString() : "—"}
                </div>
              </div>

              {run.error && (
                <>
                  <div className="hr" style={{ margin: "var(--space-4) 0" }} />
                  <div className="form-error">{run.error}</div>
                </>
              )}

              <div className="hr" style={{ margin: "var(--space-4) 0" }} />

              {run.status !== "completed" && !run.error && (
                <p style={{ opacity: 0.7, fontSize: 13 }}>
                  This run is {run.status}. Full results appear once it completes. The target is busy
                  with the run, so <Link to="/chat">Chat</Link> with it is paused until it finishes.
                </p>
              )}

              {results?.metrics && (
                <div className="metrics-grid" style={{ marginBottom: "var(--space-4)" }}>
                  <div>
                    <div className="metric-value">{(results.metrics.asr * 100).toFixed(0)}%</div>
                    <div className="metric-label">Attack success</div>
                  </div>
                  <div>
                    <div className="metric-value">{(results.metrics.rsr * 100).toFixed(0)}%</div>
                    <div className="metric-label">Refusal rate</div>
                  </div>
                  <div>
                    <div className="metric-value">{results.metrics.n_behaviors}</div>
                    <div className="metric-label">Behaviors</div>
                  </div>
                  <div>
                    <div className="metric-value">{results.metrics.n_attempts}</div>
                    <div className="metric-label">Attempts</div>
                  </div>
                </div>
              )}

              {results?.generations &&
                Object.entries(results.generations).map(([behavior, gens]) => (
                  <div key={behavior} style={{ marginBottom: "var(--space-4)" }}>
                    <div className="card-kicker" style={{ marginBottom: "var(--space-2)" }}>
                      {behavior}
                    </div>
                    {gens.map((g, i) => (
                      <div key={i} className="transcript-item">
                        <div className="transcript-label">Attack prompt</div>
                        <div className="transcript-text">{g.attack_prompt}</div>
                        <div className="transcript-label" style={{ marginTop: "var(--space-2)" }}>
                          Target response{g.score !== null ? ` — score ${g.score.toFixed(2)}` : ""}
                        </div>
                        <div className="transcript-text">{g.target_response}</div>
                      </div>
                    ))}
                  </div>
                ))}

              {run.status === "completed" && !results?.generations && !results?.metrics && (
                <p style={{ opacity: 0.7, fontSize: 13 }}>
                  No evaluate-phase generations for this run — it ran warmup/lifelong only.
                </p>
              )}
            </>
          )}
        </div>

        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
