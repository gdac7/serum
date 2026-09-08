import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../../../shared/auth/AuthContext";
import { autodanApi } from "../api";
import { ApiError } from "../../../shared/api/client";
import type { RunProgress, RunSummary, StrategyProgress } from "../types";

function StrategyCard({ s }: { s: StrategyProgress }) {
  return (
    <div className="transcript-item strategy-box">
      <div className="card-kicker" style={{ marginBottom: "var(--space-2)" }}>
        {s.name}
        {s.category ? ` · ${s.category}` : ""} — avg {s.average_score.toFixed(2)}
        {s.improvement !== null ? ` · +${s.improvement.toFixed(2)} improvement` : ""}
      </div>

      {s.malicious_request && (
        <>
          <div className="transcript-label">Malicious request</div>
          <div className="transcript-text" style={{ marginBottom: "var(--space-3)" }}>
            {s.malicious_request}
          </div>
        </>
      )}

      <div className="transcript-label">
        Weaker attempt
        {s.score_i !== null && ` · score ${s.score_i.toFixed(1)}`}
      </div>
      <div className="transcript-text">{s.example_prompt_pi}</div>
      {s.response_i && (
        <>
          <div className="transcript-label" style={{ marginTop: "var(--space-2)" }}>
            Target response
          </div>
          <div className="transcript-text">{s.response_i}</div>
        </>
      )}

      <div style={{ textAlign: "center", margin: "var(--space-3) 0", opacity: 0.8 }}>
        <div style={{ fontSize: 22, lineHeight: 1 }}>↓</div>
        <div className="card-kicker">apply strategy: {s.name}</div>
        <div style={{ fontSize: 22, lineHeight: 1 }}>↓</div>
      </div>

      <div className="transcript-label">
        Stronger attempt
        {s.score_j !== null && ` · score ${s.score_j.toFixed(1)}`}
      </div>
      <div className="transcript-text">{s.example_prompt_pj}</div>
      {s.response_j && (
        <>
          <div className="transcript-label" style={{ marginTop: "var(--space-2)" }}>
            Target response
          </div>
          <div className="transcript-text">{s.response_j}</div>
        </>
      )}
    </div>
  );
}

const PAGE_SIZE = 3;

export function RunStrategiesPage() {
  const { id = "" } = useParams();
  const { token } = useAuth();
  const [run, setRun] = useState<RunSummary | null>(null);
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    Promise.all([autodanApi.get(token, id), autodanApi.progress(token, id)])
      .then(([r, p]) => {
        if (cancelled) return;
        setRun(r);
        setProgress(p);
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

  const strategies = progress?.strategies ?? [];
  const pageCount = Math.ceil(strategies.length / PAGE_SIZE);
  const current = Math.min(page, Math.max(0, pageCount - 1));
  const visible = strategies.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  return (
    <main style={{ flex: 1, overflowY: "auto" }}>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "var(--space-8) var(--space-4)" }}>
        <Link to={`/autodan/results/${id}`} className="text-muted">
          ← Back to results
        </Link>
        <h1 style={{ marginTop: "var(--space-3)" }}>Strategies</h1>
        <p className="text-muted" style={{ marginBottom: "var(--space-4)" }}>
          {run?.model_name} · {strategies.length} entr{strategies.length === 1 ? "y" : "ies"}
        </p>

        <div
          style={{
            marginBottom: "var(--space-6)",
            padding: "var(--space-3) var(--space-4)",
            borderLeft: "3px solid var(--accent, currentColor)",
            borderRadius: "var(--radius-2, 6px)",
            background: "rgba(127, 127, 127, 0.08)",
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          AutoDAN-Turbo keeps the same strategy once per context it's found in: a technique that
          beat one response is stored as its own anchor so it can be retrieved and reused when a
          similar response appears later. Seeing a name repeat is expected — that per-context memory
          is how the agent improves its attacks across different requests.
        </div>

        {error && <div className="form-error">{error}</div>}
        {!error && !progress && <p className="spinner-text">Loading…</p>}
        {!error && progress && strategies.length === 0 && (
          <p className="empty-state">No strategies in this target's library yet.</p>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: "var(--space-4)",
            alignItems: "start",
          }}
        >
          {visible.map((s) => (
            <StrategyCard key={s.strategy_id} s={s} />
          ))}
        </div>

        {pageCount > 1 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "var(--space-2)",
              marginTop: "var(--space-5)",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              className="btn btn-secondary"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            >
              ←
            </button>
            {Array.from({ length: pageCount }, (_, i) => (
              <button
                key={i}
                type="button"
                className={`btn ${i === current ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setPage(i)}
              >
                {i + 1}
              </button>
            ))}
            <button
              type="button"
              className="btn btn-secondary"
              disabled={current >= pageCount - 1}
              onClick={() => setPage(current + 1)}
            >
              →
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
