import { createRedisConnection } from "./redis";
import type { RedTeamRunStatus, RequestScore } from "./redteam.client";

export type RunEvent =
  | { type: "snapshot"; status: string; error: string | null }
  | { type: "status"; python_status: RedTeamRunStatus; coarse: string }
  | {
      type: "progress";
      total: number;
      loaded_from_library: number | null;
      discovered_this_run: number | null;
    }
  | { type: "request_completed"; entries: RequestScore[] }
  | { type: "completed" }
  | { type: "failed"; error: string };

export const RUN_CHANNEL_PREFIX = "run:";

export function runChannel(nodeRunId: string): string {
  return `${RUN_CHANNEL_PREFIX}${nodeRunId}`;
}

const publisher = createRedisConnection();

export function publishRunEvent(nodeRunId: string, event: RunEvent): Promise<number> {
  return publisher.publish(runChannel(nodeRunId), JSON.stringify(event));
}
