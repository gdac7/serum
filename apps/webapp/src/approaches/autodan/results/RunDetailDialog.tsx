import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../shared/auth/AuthContext";
import { autodanApi } from "../api";
import { ApiError } from "../../../shared/api/client";
import { StatusTag } from "../../../shared/components/StatusTag";
import type { RunSummary } from "../types";

export function RunDetailDialog({ runId, onClose }: { runId: string; onClose: () => void }) {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [run, setRun] = useState<RunSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    autodanApi
      .get(token, runId)
      .then((r) => {
        if (!cancelled) setRun(r);
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

  const isActive = run?.status === "queued" || run?.status === "running";

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="test-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-title" id="test-title">
          {run?.model_name ?? "Run"}
        </div>

        <div className="dialog-body">
          {error && <div className="form-error">{error}</div>}
          {!error && !run && <p className="spinner-text">Loading…</p>}

          {run && (
            <>
              <p style={{ margin: "0 0 var(--space-3)" }}>
                <StatusTag status={run.status} />
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
                  <div className="card-kicker">Started</div>
                  {run.started_at ? new Date(run.started_at).toLocaleString() : "—"}
                </div>
              </div>

              {run.error && (
                <>
                  <div className="hr" style={{ margin: "var(--space-4) 0" }} />
                  <div className="form-error">{run.error}</div>
                </>
              )}
            </>
          )}
        </div>

        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
          {isActive && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => navigate(`/autodan/results/${runId}/monitor`)}
            >
              Monitor jailbreaking test
            </button>
          )}
          {run?.status === "completed" && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => navigate(`/autodan/results/${runId}`)}
            >
              See run results
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
