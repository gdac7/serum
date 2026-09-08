import type { CoarseStatus } from "../types/run";

// Maps a run's coarse status onto the design system's tag variants. A
// completed run can also report whether the approach found successful
// attacks: `attackSuccessRate` is optional because not every approach
// measures one, and it stays a number here so this stays approach-agnostic.
export function StatusTag({
  status,
  attackSuccessRate,
}: {
  status: CoarseStatus;
  attackSuccessRate?: number | null;
}) {
  if (status === "failed") {
    return <span className="tag tag-accent">Failed</span>;
  }
  if (status === "queued" || status === "running") {
    return <span className="tag tag-outline">{status === "queued" ? "Queued" : "Running"}</span>;
  }
  if (attackSuccessRate != null && attackSuccessRate > 0) {
    return <span className="tag tag-accent">Flagged</span>;
  }
  return (
    <span className="tag tag-neutral">{attackSuccessRate != null ? "Passed" : "Completed"}</span>
  );
}
