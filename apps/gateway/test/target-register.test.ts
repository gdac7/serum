import { describe, it, expect, vi, beforeEach } from "vitest";

const create = vi.hoisted(() => vi.fn());
const setPythonTargetId = vi.hoisted(() => vi.fn());
const setStatus = vi.hoisted(() => vi.fn());
const remove = vi.hoisted(() => vi.fn());
vi.mock("../src/repositories/target.repository", () => ({
  targetRepository: {
    create,
    setPythonTargetId,
    setStatus,
    delete: remove,
  },
}));

const createClient = vi.hoisted(() => vi.fn());
const registerTarget = vi.hoisted(() => vi.fn());
vi.mock("../src/infra/redteam.client", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, redTeamClient: { createClient, registerTarget } };
});

const probeFromService = vi.hoisted(() => vi.fn());
vi.mock("../src/services/service-probe", () => ({ probeFromService }));

import { targetService } from "../src/services/target.service";
import { HttpError } from "../src/domain/errors";

const USER = "11111111-1111-1111-1111-111111111111";
const ROW = "22222222-2222-2222-2222-222222222222";
const PY_TARGET = "33333333-3333-3333-3333-333333333333";

function row(kind: string, endpointUrl: string | null) {
  return {
    id: ROW,
    user_id: USER,
    kind,
    model_name: "my-model",
    endpoint_url: endpointUrl,
    encrypted_api_key: null,
    prompt_field: null,
    response_field: null,
    load_4_bits: false,
    python_target_id: null,
    status: "loading",
    error: null,
    created_at: new Date(),
    updated_at: new Date(),
  };
}

beforeEach(() => {
  create.mockReset();
  setPythonTargetId.mockReset();
  setStatus.mockReset();
  remove.mockReset();
  createClient.mockReset();
  registerTarget.mockReset();
  probeFromService.mockReset();
  registerTarget.mockResolvedValue({ target_id: PY_TARGET, status: "loading" });
});

describe("targetService.register", () => {
  // The regression: a connector has no token and no running agent until after
  // registration returns, so probing here deleted every connector target and
  // left the feature unreachable -- no target, no token, no connector.
  it("does not probe a connector target, which cannot be reachable yet", async () => {
    create.mockResolvedValue(row("connector", "http://localhost:8000/generate"));
    // What the bridge really answers with no connector attached yet, so that
    // probing at all would delete the row rather than fail on a bare mock.
    probeFromService.mockResolvedValue({
      ok: false,
      code: "refused",
      message: "no connector is running for this target",
    });

    const result = await targetService.register(USER, {
      kind: "connector",
      model_name: "my-model",
      endpoint_url: "http://localhost:8000/generate",
      load_4_bits: false,
    } as never);

    expect(probeFromService).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(result).toEqual({ target_id: ROW, status: "loading" });
  });

  it("does not probe a local target, which has no endpoint", async () => {
    create.mockResolvedValue(row("local", null));

    await targetService.register(USER, {
      kind: "local",
      model_name: "org/model",
      load_4_bits: false,
    } as never);

    expect(probeFromService).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("keeps an api target whose endpoint answers", async () => {
    create.mockResolvedValue(row("api", "https://model.example.com/generate"));
    probeFromService.mockResolvedValue({ ok: true, sample: "hi" });

    await targetService.register(USER, {
      kind: "api",
      model_name: "my-model",
      endpoint_url: "https://model.example.com/generate",
      load_4_bits: false,
    } as never);

    expect(probeFromService).toHaveBeenCalledWith(USER, PY_TARGET);
    expect(remove).not.toHaveBeenCalled();
  });

  // Still the point of probing at all: a broken endpoint is rejected at
  // registration rather than leaving a dead row to fail later in a run.
  it("deletes an api target whose endpoint cannot be reached", async () => {
    create.mockResolvedValue(row("api", "https://model.example.com/generate"));
    probeFromService.mockResolvedValue({
      ok: false,
      code: "refused",
      message: "Connection refused",
    });

    await expect(
      targetService.register(USER, {
        kind: "api",
        model_name: "my-model",
        endpoint_url: "https://model.example.com/generate",
        load_4_bits: false,
      } as never),
    ).rejects.toThrow(HttpError);

    expect(remove).toHaveBeenCalledWith(ROW, USER);
  });
});
