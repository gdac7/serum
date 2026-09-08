import { env } from "../config/env";
import type { TargetConfig } from "../infra/redteam.client";

export function bridgeUrl(targetRowId: string): string {
  return `${env.INTERNAL_BASE_URL}/bridge/targets/${targetRowId}`;
}

/**
 * A connector target reaches the red-team service as an ordinary api target
 * whose endpoint is this gateway; the connector on the user's machine supplies
 * the model behind it. The service needs no concept of a connector, and
 * target_key stays stable because the url is derived from the row id.
 */
export function connectorTargetConfig(modelName: string, targetRowId: string): TargetConfig {
  return {
    kind: "api",
    model_name: modelName,
    endpoint_url: bridgeUrl(targetRowId),
    api_key: env.BRIDGE_SECRET,
  };
}
