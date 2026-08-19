import { describe, it, expect, vi, afterEach } from "vitest";
import { probeEndpoint } from "../src/infra/endpoint-probe";

const URL_OK = "https://api.example.com/generate";

function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response> | never) {
  const spy = vi.fn(impl as never);
  vi.stubGlobal("fetch", spy);
  return spy;
}

function jsonResponse(body: unknown, status = 200, statusText = "OK") {
  return Promise.resolve(
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      statusText,
      headers: { "content-type": "application/json" },
    }),
  );
}

function networkError(code: string) {
  const err = new TypeError("fetch failed");
  (err as { cause?: unknown }).cause = Object.assign(new Error(code), { code });
  return err;
}

afterEach(() => vi.unstubAllGlobals());

describe("probeEndpoint", () => {
  it("rejects a private host without opening a connection", async () => {
    const spy = stubFetch(() => jsonResponse({ output: "hi" }));
    const result = await probeEndpoint("https://localhost:7070/gentext/");

    expect(result).toMatchObject({ ok: false, code: "loopback" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("names the offending host so the user can see what we resolved", async () => {
    stubFetch(() => jsonResponse({ output: "hi" }));
    const result = await probeEndpoint("https://127.0.0.1/x");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("127.0.0.1");
  });

  it("rejects a malformed url", async () => {
    const result = await probeEndpoint("not a url");
    expect(result).toMatchObject({ ok: false, code: "dns" });
  });

  it("sends the endpoint contract, with the api key when there is one", async () => {
    const spy = stubFetch(() => jsonResponse({ output: "hi" }));
    await probeEndpoint(URL_OK, { apiKey: "sk-1", promptField: "prompt" });

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(URL_OK);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ prompt: "ping" });
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-1");
  });

  it("omits the authorization header when no key is given", async () => {
    const spy = stubFetch(() => jsonResponse({ output: "hi" }));
    await probeEndpoint(URL_OK);

    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it.each([
    ["ECONNREFUSED", "refused"],
    ["EHOSTUNREACH", "refused"],
    ["ENOTFOUND", "dns"],
    ["EAI_AGAIN", "dns"],
    ["CERT_HAS_EXPIRED", "tls"],
    ["DEPTH_ZERO_SELF_SIGNED_CERT", "tls"],
    ["ERR_TLS_CERT_ALTNAME_INVALID", "tls"],
  ])("classifies %s as %s", async (code, expected) => {
    stubFetch(() => {
      throw networkError(code);
    });
    expect(await probeEndpoint(URL_OK)).toMatchObject({ ok: false, code: expected });
  });

  it("classifies an aborted request as a timeout", async () => {
    stubFetch(() => {
      throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    });
    expect(await probeEndpoint(URL_OK)).toMatchObject({ ok: false, code: "timeout" });
  });

  it("falls back to refused for an unrecognised failure", async () => {
    stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    expect(await probeEndpoint(URL_OK)).toMatchObject({ ok: false, code: "refused" });
  });

  it("reports a non-2xx status with the response body", async () => {
    stubFetch(() => jsonResponse({ detail: "bad request" }, 422, "Unprocessable Entity"));
    const result = await probeEndpoint(URL_OK);

    expect(result).toMatchObject({ ok: false, code: "http_status" });
    if (!result.ok) {
      expect(result.message).toContain("422");
      expect(result.message).toContain("bad request");
    }
  });

  it("hints at the api key on 401", async () => {
    stubFetch(() => jsonResponse({}, 401, "Unauthorized"));
    const result = await probeEndpoint(URL_OK);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("API key");
  });

  it("accepts the configured response field", async () => {
    stubFetch(() => jsonResponse({ reply: "pong" }));
    expect(await probeEndpoint(URL_OK, { responseField: "reply" })).toEqual({
      ok: true,
      sample: "pong",
    });
  });

  it("accepts the fallback fields the service also accepts", async () => {
    for (const field of ["output", "generated_text", "response", "text"]) {
      stubFetch(() => jsonResponse({ [field]: "pong" }));
      expect(await probeEndpoint(URL_OK), field).toEqual({ ok: true, sample: "pong" });
    }
  });

  it("accepts a bare string body", async () => {
    stubFetch(() => jsonResponse('"pong"'));
    expect(await probeEndpoint(URL_OK)).toEqual({ ok: true, sample: "pong" });
  });

  it("reports the keys it did get when the reply field is missing", async () => {
    stubFetch(() => jsonResponse({ result: "pong", usage: 3 }));
    const result = await probeEndpoint(URL_OK);

    expect(result).toMatchObject({ ok: false, code: "bad_shape" });
    if (!result.ok) {
      expect(result.message).toContain("result");
      expect(result.message).toContain("usage");
    }
  });

  it("rejects a 200 that is not json", async () => {
    stubFetch(() =>
      Promise.resolve(new Response("<html>oops</html>", { status: 200 })),
    );
    expect(await probeEndpoint(URL_OK)).toMatchObject({ ok: false, code: "bad_shape" });
  });
});
