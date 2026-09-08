import { useMemo, useState } from "react";
import type { RequestScore } from "../types";

const PAGE_SIZE = 10;

const PHASE_LABEL: Record<string, string> = {
  warmup: "Warm-up",
  lifelong: "Lifelong",
};

/** Per-malicious-request scores, filled in as each request finishes a phase. */
export function RequestScoresTable({ entries }: { entries: RequestScore[] }) {
  const [page, setPage] = useState(0);

  const pageCount = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const rows = useMemo(
    () => entries.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE),
    [entries, current],
  );

  if (entries.length === 0) {
    return (
      <p className="empty-state">
        No malicious request has finished yet — scores appear as each one completes.
      </p>
    );
  }

  return (
    <>
      <table className="table">
        <thead>
          <tr>
            <th>#</th>
            <th>Malicious request</th>
            <th>Phase</th>
            <th>Attempts</th>
            <th>Avg score</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.phase}-${r.request_index}-${r.completed_at}`}>
              <td className="text-muted">{r.request_index}</td>
              <td>{r.malicious_request}</td>
              <td className="text-muted">{PHASE_LABEL[r.phase] ?? r.phase}</td>
              <td>{r.attempts}</td>
              <td>{r.average_score !== null ? r.average_score.toFixed(2) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {pageCount > 1 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            marginTop: "var(--space-3)",
          }}
        >
          <button
            type="button"
            className="btn btn-secondary"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            ← Previous
          </button>
          <span className="text-muted">
            Page {current + 1} of {pageCount} · {entries.length} requests
          </span>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={current >= pageCount - 1}
            onClick={() => setPage(current + 1)}
          >
            Next →
          </button>
        </div>
      )}
    </>
  );
}
