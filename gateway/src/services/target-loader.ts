import { HttpError } from "../domain/errors";
import { redTeamClient, TargetConfig } from "../infra/redteam.client";

const TARGET_POLL_MS = 3000;
const TARGET_LOAD_TIMEOUT_MS = 120000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Registers (or re-registers, idempotently — same config always resolves to
// the same target_id) a target with Python and waits for it to finish
// loading. Python drops every target's GPU weights on restart, so a stored
// target id is trusted only after a fresh health check confirms it's still
// live; shared by run-scoped chat and standalone target chat/registration.
export async function ensureTargetLoaded(
  clientId: string,
  config: TargetConfig,
  storedTargetId: string | null,
  onStatus?: (text: string) => void,
): Promise<string> {
  if (storedTargetId) {
    const health = await redTeamClient.getTargetHealth(clientId, storedTargetId);
    if (health.status === "loaded") return storedTargetId;
  }

  onStatus?.("loading target");
  await redTeamClient.createClient(clientId);
  const target = await redTeamClient.registerTarget(clientId, config);
  const targetId = target.target_id;

  const deadline = Date.now() + TARGET_LOAD_TIMEOUT_MS;
  for (;;) {
    const health = await redTeamClient.getTargetHealth(clientId, targetId);
    if (health.status === "loaded") return targetId;
    if (health.status === "failed") {
      throw new HttpError(502, `target failed to load: ${health.error ?? "unknown"}`);
    }
    if (Date.now() > deadline) {
      throw new HttpError(504, "target did not finish loading in time");
    }
    await sleep(TARGET_POLL_MS);
  }
}
