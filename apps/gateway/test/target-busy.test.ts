import { describe, it, expect } from "vitest";

import { targetBusyReason } from "../src/services/target.service";

const LOCAL = { kind: "local", python_target_id: "py-local" } as never;
const API = { kind: "api", python_target_id: "py-api" } as never;

describe("target availability during a run", () => {
  // The bug: chat refused a local target while a run against a *remote* one was
  // going, because attacker/scorer/summarizer are local and hold the one GPU.
  // The UI said it was free, then the service refused it.
  it("reports GPU contention for a local target during another target's run", () => {
    expect(targetBusyReason(LOCAL, new Set(["py-api"]), true)).toBe("gpu_busy");
  });

  it("leaves a remote target free during a run against a different target", () => {
    expect(targetBusyReason(API, new Set(["py-other"]), true)).toBeNull();
  });

  it("reports the target's own active run", () => {
    expect(targetBusyReason(API, new Set(["py-api"]), true)).toBe("active_run");
    expect(targetBusyReason(LOCAL, new Set(["py-local"]), true)).toBe("active_run");
  });

  it("frees everything when no run is active", () => {
    expect(targetBusyReason(LOCAL, new Set(), false)).toBeNull();
    expect(targetBusyReason(API, new Set(), false)).toBeNull();
  });
});
