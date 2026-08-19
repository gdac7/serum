import { describe, it, expect } from "vitest";
import { bridgeUrl, connectorTargetConfig } from "../src/domain/target-config";

const TARGET_ID = "11111111-1111-1111-1111-111111111111";

describe("connectorTargetConfig", () => {
  it("presents a connector as an ordinary api target", () => {
    const config = connectorTargetConfig("my-model", TARGET_ID);
    expect(config.kind).toBe("api");
    expect(config.model_name).toBe("my-model");
    expect(config.endpoint_url).toBe(bridgeUrl(TARGET_ID));
  });

  it("carries the bridge secret so the service can authenticate", () => {
    expect(connectorTargetConfig("m", TARGET_ID).api_key).toBe(process.env.BRIDGE_SECRET);
  });

  // target_key is derived from endpoint_url, so a url that moved between runs
  // would strand the strategy library the previous runs built.
  it("derives a stable url from the target id", () => {
    expect(connectorTargetConfig("a", TARGET_ID).endpoint_url).toBe(
      connectorTargetConfig("b", TARGET_ID).endpoint_url,
    );
    expect(bridgeUrl(TARGET_ID)).toContain(TARGET_ID);
  });
});
