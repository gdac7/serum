import { describe, it, expect, vi, beforeEach } from "vitest";

const chatStream = vi.hoisted(() => vi.fn());
vi.mock("../src/infra/redteam.client", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, redTeamClient: { chatStream } };
});

import { probeFromService } from "../src/services/service-probe";

function sseResponse(frames: unknown[]) {
  const body = frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("");
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

// Block body: mockReset returns the mock, and a hook's return value is
// inspected by the runner.
beforeEach(() => {
  chatStream.mockReset();
});

describe("probeFromService", () => {
  it("joins the streamed text into a sample", async () => {
    chatStream.mockResolvedValue(
      sseResponse([
        { type: "status", text: "loading target" },
        { type: "token", text: "hello " },
        { type: "token", text: "world" },
      ]),
    );
    expect(await probeFromService("c", "t")).toEqual({ ok: true, sample: "hello world" });
  });

  // The whole point: the service reaches the endpoint, not the gateway, so its
  // error is the authoritative one.
  it("surfaces the service's own connection error", async () => {
    chatStream.mockResolvedValue(
      sseResponse([
        {
          type: "error",
          error:
            "ConnectionError: HTTPSConnectionPool(host='localhost', port=7070): Connection refused",
        },
      ]),
    );
    const result = await probeFromService("c", "t");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("port=7070");
  });

  it("reports an answer with no text rather than calling it a success", async () => {
    chatStream.mockResolvedValue(sseResponse([{ type: "status", text: "" }]));
    const result = await probeFromService("c", "t");
    expect(result).toMatchObject({ ok: false, code: "bad_shape" });
  });

  // Prefers the service's response body over the wrapper message, which only
  // repeats the status.
  it("turns a service error response into a failure, not a throw", async () => {
    chatStream.mockImplementation(async () => {
      throw Object.assign(new Error("red-team service /chat responded 409"), {
        status: 409,
        body: "target is in use",
      });
    });
    const result = await probeFromService("c", "t");
    expect(result).toMatchObject({ ok: false, code: "http_status" });
    if (!result.ok) expect(result.message).toContain("in use");
  });
});
