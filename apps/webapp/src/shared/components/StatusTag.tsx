import type { CoarseStatus } from "../types/run";
import type { HarmbenchMetrics } from "../types/run";

// Maps a run's coarse status (and, for a completed run, whether HarmBench
// found successful attacks) onto the design system's tag variants.
export function StatusTag({
  status,
  metrics,
}: {
  status: CoarseStatus;
  metrics?: HarmbenchMetrics | null;
}) {
  if (status === "failed") {
    return <span className="tag tag-accent">Failed</span>;
  }
  if (status === "queued" || status === "running") {
    return <span className="tag tag-outline">{status === "queued" ? "Queued" : "Running"}</span>;
  }
  if (metrics && metrics.asr > 0) {
    return <span className="tag tag-accent">Flagged</span>;
  }
  return <span className="tag tag-neutral">{metrics ? "Passed" : "Completed"}</span>;
}
