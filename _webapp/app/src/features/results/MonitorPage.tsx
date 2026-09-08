import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../shared/auth/AuthContext";
import { runsApi, subscribeRunEvents } from "../../shared/api/runs";
import { ApiError } from "../../shared/api/client";
import { StatusTag } from "../../shared/components/StatusTag";
import type { RequestScore, RunProgress, RunSummary } from "../../shared/types/run";
import { RequestScoresTable } from "./RequestScoresTable";

const POLL_MS = 4000;

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// Attempt-weighted mean over the requests finished so far — the same quantity
// the phase summary reports at the end, just computed from a partial run.
function averageScore(entries: RequestScore[]): number | null {
  let attempts = 0;
  let sum = 0;
  for (const e of entries) {
    if (e.average_score === null) continue;
    attempts += e.attempts;
    sum += e.average_score * e.attempts;
  }
  return attempts > 0 ? sum / attempts : null;
}

export function MonitorPage() {
  const { id = "" } = useParams();
  const { token } = useAuth();
  const navigate = useNavigate();
  const [run, setRun] = useState<RunSummary | null>(null);
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const runRef = useRef<RunSummary | null>(null);
  runRef.current = run;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    const refreshRun = () =>
      runsApi
        .get(token, id)
        .then((r) => {
          if (!cancelled) setRun(r);
        })
        .catch((err) => {
          if (!cancelled && err instanceof ApiError && err.status === 404) {
            setError("run not found");
          }
        });

    const poll = () =>
      runsApi
        .progress(token, id)
        .then((p) => {
          if (!cancelled) setProgress(p);
        })
        // 409 = run hasn't reached Python yet (still queued); keep waiting.
        .catch((err) => {
          if (!cancelled && err instanceof ApiError && err.status !== 409) {
            setError(err.message);
          }
        });

    refreshRun();
    poll();
    const interval = setInterval(() => {
      refreshRun();
      poll();
    }, POLL_MS);
    const unsubscribe = subscribeRunEvents(token, id, (frame) => {
      // A request finishing is worth showing before the next poll comes round.
      if (frame.type === "request_completed") {
        poll();
        return;
      }
      const coarse = (frame.coarse as string | undefined) ?? (frame.type as string);
      if (coarse === "completed" || coarse === "failed") {
        refreshRun();
        if (coarse === "completed") navigate(`/results/${id}`, { replace: true });
      }
    });

    return () => {
      cancelled = true;
      clearInterval(interval);
      unsubscribe();
    };
  }, [token, id, navigate]);

  const discovered = progress?.discovered_this_run ?? progress?.total ?? 0;
  const requestScores = progress?.request_scores ?? [];
  const avg = averageScore(requestScores);
  const startedAt = run?.started_at ? new Date(run.started_at).getTime() : null;

  return (
    <main style={{ flex: 1, overflowY: "auto" }}>
      <div style={{ maxWidth: 820, margin: "0 auto", padding: "var(--space-8) var(--space-4)" }}>
        <Link to="/results" className="text-muted">
          ← Back to tests
        </Link>
        <h1 style={{ marginTop: "var(--space-3)" }}>{run?.model_name ?? "Run"}</h1>
        <p style={{ marginBottom: "var(--space-6)" }}>
          {run && <StatusTag status={run.status} />}{" "}
          <span className="text-muted">Monitoring live — updates every few seconds.</span>
        </p>

        {error && <div className="form-error">{error}</div>}
        {run?.status === "failed" && run.error && <div className="form-error">{run.error}</div>}

        {run && run.status !== "running" && run.status !== "queued" && !error && (
          <p className="empty-state">
            This run is {run.status}.{" "}
            {run.status === "completed" ? (
              <Link to={`/results/${id}`}>See results</Link>
            ) : (
              "Nothing to monitor."
            )}
          </p>
        )}

        {run && (run.status === "running" || run.status === "queued") && (
          <div className="metrics-grid">
            <div>
              <div className="metric-value">{discovered}</div>
              <div className="metric-label">Strategies discovered</div>
            </div>
            <div>
              <div className="metric-value">
                {startedAt ? formatElapsed(now - startedAt) : "—"}
              </div>
              <div className="metric-label">Time running</div>
            </div>
            <div>
              <div className="metric-value">{avg !== null ? avg.toFixed(2) : "—"}</div>
              <div className="metric-label">Average score</div>
            </div>
          </div>
        )}

        {run && (run.status === "running" || run.status === "queued") && (
          <>
            <h2 style={{ marginTop: "var(--space-8)" }}>Score per malicious request</h2>
            <RequestScoresTable entries={requestScores} />
          </>
        )}
      </div>
    </main>
  );
}
