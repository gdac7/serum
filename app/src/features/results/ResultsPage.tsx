import { useEffect, useState } from "react";
import { useAuth } from "../../shared/auth/AuthContext";
import { runsApi, subscribeRunEvents } from "../../shared/api/runs";
import { ApiError } from "../../shared/api/client";
import { StatusTag } from "../../shared/components/StatusTag";
import type { RunSummary } from "../../shared/types/run";
import { RunDetailDialog } from "./RunDetailDialog";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ResultsPage() {
  const { token } = useAuth();
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    runsApi
      .list(token)
      .then((data) => {
        if (!cancelled) setRuns(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "failed to load runs");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Live-update rows still in flight; terminal rows need no subscription.
  useEffect(() => {
    if (!token || !runs) return;
    const unsubscribers = runs
      .filter((r) => r.status === "queued" || r.status === "running")
      .map((r) =>
        subscribeRunEvents(token, r.node_run_id, (frame) => {
          const coarse = (frame.coarse as string | undefined) ?? (frame.type as string);
          if (coarse === "completed" || coarse === "failed" || frame.type === "completed" || frame.type === "failed") {
            runsApi
              .get(token, r.node_run_id)
              .then((fresh) =>
                setRuns((prev) => prev?.map((row) => (row.node_run_id === fresh.node_run_id ? fresh : row)) ?? prev),
              )
              .catch(() => {});
          }
        }),
      );
    return () => unsubscribers.forEach((unsub) => unsub());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, runs?.map((r) => r.node_run_id + r.status).join(",")]);

  return (
    <main style={{ flex: 1, overflowY: "auto" }}>
      <div style={{ maxWidth: 820, margin: "0 auto", padding: "var(--space-8) var(--space-4)" }}>
        <h1>Recent tests</h1>
        <p style={{ opacity: 0.7, marginBottom: "var(--space-6)" }}>
          Click a row for details.
        </p>

        {error && <div className="form-error">{error}</div>}
        {!error && !runs && <p className="spinner-text">Loading…</p>}
        {!error && runs && runs.length === 0 && (
          <p className="empty-state">No runs yet — start one from Security Testing.</p>
        )}

        {!error && runs && runs.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Target model</th>
                <th>Kind</th>
                <th>Phases</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.node_run_id} data-clickable onClick={() => setSelectedId(run.node_run_id)}>
                  <td>{run.model_name}</td>
                  <td className="text-muted">{run.target_kind}</td>
                  <td>{run.phases.join(", ")}</td>
                  <td>
                    <StatusTag status={run.status} />
                  </td>
                  <td className="text-muted">{formatDate(run.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selectedId && <RunDetailDialog runId={selectedId} onClose={() => setSelectedId(null)} />}
    </main>
  );
}
