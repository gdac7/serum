import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../../shared/auth/AuthContext";
import { runsApi } from "../../shared/api/runs";
import { ApiError } from "../../shared/api/client";
import type { RunResults, RunSummary } from "../../shared/types/run";

interface TranscriptRow {
  behavior: string;
  malicious_request: string;
  attack_prompt: string;
  target_response: string;
  score: number | null;
}

function flatten(results: RunResults | null): TranscriptRow[] {
  if (!results?.generations) return [];
  const rows: TranscriptRow[] = [];
  for (const [behavior, gens] of Object.entries(results.generations)) {
    for (const g of gens) {
      rows.push({
        behavior,
        malicious_request: g.malicious_request,
        attack_prompt: g.attack_prompt,
        target_response: g.target_response,
        score: g.score,
      });
    }
  }
  return rows;
}

function downloadPrompts(fileStem: string, rows: TranscriptRow[]): void {
  const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${fileStem}-attack-prompts.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function RunTranscriptPage() {
  const { id = "" } = useParams();
  const { token } = useAuth();
  const [run, setRun] = useState<RunSummary | null>(null);
  const [results, setResults] = useState<RunResults | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    Promise.all([runsApi.get(token, id), runsApi.results(token, id)])
      .then(([r, res]) => {
        if (cancelled) return;
        setRun(r);
        setResults(res);
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

  const rows = useMemo(() => flatten(results), [results]);
  const fileStem = (run?.model_name ?? "run").replace(/[^a-z0-9._-]+/gi, "_");

  return (
    <main style={{ flex: 1, overflowY: "auto" }}>
      <div style={{ maxWidth: 820, margin: "0 auto", padding: "var(--space-8) var(--space-4)" }}>
        <Link to={`/results/${id}`} className="text-muted">
          ← Back to results
        </Link>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--space-3)",
            marginTop: "var(--space-3)",
          }}
        >
          <h1 style={{ margin: 0 }}>Attack prompts &amp; responses</h1>
          {rows.length > 0 && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => downloadPrompts(fileStem, rows)}
            >
              Download attack prompts
            </button>
          )}
        </div>
        <p className="text-muted" style={{ marginBottom: "var(--space-6)" }}>
          {run?.model_name} · {rows.length} attempt{rows.length === 1 ? "" : "s"}
        </p>

        {error && <div className="form-error">{error}</div>}
        {!error && !results && <p className="spinner-text">Loading…</p>}
        {!error && results && rows.length === 0 && (
          <p className="empty-state">
            No scored generations — this run had no evaluate phase.
          </p>
        )}

        {rows.map((row, i) => (
          <div key={i} className="transcript-item">
            <div className="card-kicker" style={{ marginBottom: "var(--space-2)" }}>
              {row.behavior}
              {row.score !== null ? ` — score ${row.score.toFixed(2)}` : ""}
            </div>
            <div className="transcript-label">Attack prompt</div>
            <div className="transcript-text">{row.attack_prompt}</div>
            <div className="transcript-label" style={{ marginTop: "var(--space-2)" }}>
              Target response
            </div>
            <div className="transcript-text">{row.target_response}</div>
          </div>
        ))}
      </div>
    </main>
  );
}
