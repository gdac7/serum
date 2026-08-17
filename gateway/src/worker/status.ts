import type { RedTeamRunStatus } from "../infra/redteam.client";

// Python's fine-grained phases collapse to the coarse client-facing machine.
export function toCoarseStatus(status: RedTeamRunStatus): string {
  switch (status) {
    case "queued":
      return "queued";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return "running";
  }
}
