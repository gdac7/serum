import { describe, it, expect } from "vitest";
import { toCoarseStatus } from "../src/worker/status";

describe("toCoarseStatus", () => {
  it("passes terminal and queued states through", () => {
    expect(toCoarseStatus("queued")).toBe("queued");
    expect(toCoarseStatus("completed")).toBe("completed");
    expect(toCoarseStatus("failed")).toBe("failed");
  });

  it("collapses every in-progress phase to running", () => {
    for (const s of ["warmup", "lifelong", "evaluating", "scoring"] as const) {
      expect(toCoarseStatus(s)).toBe("running");
    }
  });
});
