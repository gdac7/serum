import { describe, it, expect } from "vitest";

import { isBusy } from "../src/services/target.service";

const LOCAL = { kind: "local", python_target_id: "py-local" } as never;
const API = { kind: "api", python_target_id: "py-api" } as never;

describe("target availability during a run", () => {
  // The bug: chat refused a local target while a run against a *remote* one was
  // going, because attacker/scorer/summarizer are local and hold the one GPU.
  // The UI said it was free, then the service refused it.
  it("marks a local target busy during a run against another target", () => {
    expect(isBusy(LOCAL, new Set(["py-api"]), true)).toBe(true);
  });

  it("leaves a remote target free during a run against a different target", () => {
    expect(isBusy(API, new Set(["py-other"]), true)).toBe(false);
  });

  it("marks a remote target busy during its own run", () => {
    expect(isBusy(API, new Set(["py-api"]), true)).toBe(true);
  });

  it("frees everything when no run is active", () => {
    expect(isBusy(LOCAL, new Set(), false)).toBe(false);
    expect(isBusy(API, new Set(), false)).toBe(false);
  });
});
