import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../../shared/auth/AuthContext";
import { runsApi } from "../../shared/api/runs";
import { ApiError } from "../../shared/api/client";
import type { RunPrompts, RunResults, RunSummary } from "../../shared/types/run";

interface TranscriptRow {
  phase: string;
  malicious_request: string;
  attack_prompt: string;
  target_response: string;
  score: number | null;
}

const PHASE_LABEL: Record<string, string> = {
  warmup: "Warm-up",
  lifelong: "Lifelong",
  evaluate: "Evaluate",
};

// Training phases come from /prompts; the evaluate phase is scored separately
// and lives in /results generations. Both share the same tuple shape.
function collectRows(prompts: RunPrompts | null, results: RunResults | null): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  for (const phase of ["warmup", "lifelong"]) {
    for (const p of prompts?.prompts[phase] ?? []) {
      rows.push({
        phase,
        malicious_request: p.malicious_request,
        attack_prompt: p.attack_prompt,
        target_response: p.target_response,
        score: p.score,
      });
    }
  }
  for (const gens of Object.values(results?.generations ?? {})) {
    for (const g of gens) {
      rows.push({
        phase: "evaluate",
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
  const [prompts, setPrompts] = useState<RunPrompts | null>(null);
  const [results, setResults] = useState<RunResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [promptsError, setPromptsError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    Promise.all([
      runsApi.get(token, id),
      runsApi.prompts(token, id).catch((e) => {
        if (!cancelled) setPromptsError(e instanceof ApiError ? `${e.status}: ${e.message}` : String(e));
        return null;
      }),
      runsApi.results(token, id).catch(() => null),
    ])
      .then(([r, p, res]) => {
        if (cancelled) return;
        setRun(r);
        setPrompts(p);
        setResults(res);
        setLoaded(true);
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

  const rows = useMemo(() => collectRows(prompts, results), [prompts, results]);
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
        {!error && !loaded && <p className="spinner-text">Loading…</p>}
        {!error && loaded && rows.length === 0 && promptsError && (
          <div className="form-error">Couldn't load prompts — {promptsError}</div>
        )}
        {!error && loaded && rows.length === 0 && !promptsError && (
          <p className="empty-state">
            No generated prompts recorded for this run. Training prompts are only
            captured for runs completed after the service was updated — start a new
            run to populate them.
          </p>
        )}

        {rows.map((row, i) => (
          <div key={i} className="transcript-item">
            <div className="card-kicker" style={{ marginBottom: "var(--space-2)" }}>
              {PHASE_LABEL[row.phase] ?? row.phase} · {row.malicious_request}
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
