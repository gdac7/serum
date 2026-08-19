// Sends one request in the target endpoint contract (POST {prompt_field} ->
// {response_field}) and classifies the failure into something actionable.

import { env } from "../config/env";
import { isPrivateHost } from "./host";

const DEFAULT_PROMPT_FIELD = "input_text";
const DEFAULT_RESPONSE_FIELD = "output";

// Must match RESPONSE_FALLBACK_FIELDS in the service's remote_model.py: a body
// the probe rejects here would otherwise be accepted mid-run, and vice versa.
const RESPONSE_FALLBACK_FIELDS = ["output", "generated_text", "response", "text"];

// A generation gets 300s; this runs while someone waits on a form.
const PROBE_TIMEOUT_MS = 10_000;
const PROBE_PROMPT = "ping";

export type ProbeFailureCode =
  | "loopback"
  | "dns"
  | "refused"
  | "tls"
  | "timeout"
  | "http_status"
  | "bad_shape";

export type ProbeResult =
  | { ok: true; sample: string }
  | { ok: false; code: ProbeFailureCode; message: string };

export interface ProbeOptions {
  apiKey?: string;
  promptField?: string;
  responseField?: string;
  /** For gateway-built urls only. User input must never set this: the host
   *  check is what stops a target config from reaching our internal network. */
  allowPrivateHost?: boolean;
}

class ProbeShapeError extends Error {}

function extract(body: unknown, responseField: string): string {
  if (typeof body === "string") return body;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ProbeShapeError(
      `endpoint returned ${Array.isArray(body) ? "an array" : typeof body}, expected a JSON object or a string`,
    );
  }
  const record = body as Record<string, unknown>;
  for (const field of [responseField, ...RESPONSE_FALLBACK_FIELDS]) {
    if (typeof record[field] === "string") return record[field] as string;
  }
  throw new ProbeShapeError(
    `endpoint replied without a "${responseField}" string field — it returned the keys ` +
      `${JSON.stringify(Object.keys(record))}. Set the response field to the one holding the ` +
      `model's reply, or have the endpoint return {"${responseField}": "..."}.`,
  );
}

function causeCode(err: unknown): string {
  const cause = (err as { cause?: { code?: unknown } })?.cause;
  return typeof cause?.code === "string" ? cause.code : "";
}

function classify(err: unknown, hostname: string): { code: ProbeFailureCode; message: string } {
  const name = (err as Error)?.name;
  if (name === "TimeoutError" || name === "AbortError") {
    return {
      code: "timeout",
      message: `The endpoint did not respond within ${PROBE_TIMEOUT_MS / 1000}s.`,
    };
  }

  const code = causeCode(err);
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return {
      code: "dns",
      message: `The host ${hostname} could not be resolved. Check it for typos, and that it is in public DNS rather than a name only your own network knows.`,
    };
  }
  if (code === "ECONNREFUSED" || code === "ECONNRESET" || code === "EHOSTUNREACH") {
    return {
      code: "refused",
      message:
        "Nothing accepted the connection at that address. The endpoint has to be reachable from the public internet — a model running inside your own network is not.",
    };
  }
  if (code.startsWith("CERT_") || code.startsWith("ERR_TLS") || code.includes("SELF_SIGNED")) {
    return {
      code: "tls",
      message: `The endpoint's TLS certificate was rejected (${code}). A self-signed certificate has to be replaced with one from a trusted authority.`,
    };
  }
  return {
    code: "refused",
    message: `Could not reach the endpoint: ${(err as Error)?.message ?? String(err)}`,
  };
}

export async function probeEndpoint(url: string, opts: ProbeOptions = {}): Promise<ProbeResult> {
  const promptField = opts.promptField || DEFAULT_PROMPT_FIELD;
  const responseField = opts.responseField || DEFAULT_RESPONSE_FIELD;

  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return { ok: false, code: "dns", message: `"${url}" is not a valid URL.` };
  }

  // ALLOW_PRIVATE_ENDPOINTS means the operator runs the endpoint alongside the
  // gateway, so a private address is the intended target rather than a mistake.
  if (isPrivateHost(hostname) && !env.ALLOW_PRIVATE_ENDPOINTS && !opts.allowPrivateHost) {
    return {
      ok: false,
      code: "loopback",
      message:
        `${hostname} is a private address, resolved on our servers — it points at our own ` +
        `machine, not yours, so your model is not there. The endpoint has to be reachable ` +
        `from the public internet.`,
    };
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
      },
      body: JSON.stringify({ [promptField]: PROBE_PROMPT }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, ...classify(err, hostname) };
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 200);
    const hint =
      response.status === 401 || response.status === 403
        ? " It rejected our credentials — check the API key."
        : "";
    return {
      ok: false,
      code: "http_status",
      message: `The endpoint answered ${response.status} ${response.statusText}.${hint}${detail ? ` Response: ${detail}` : ""}`,
    };
  }

  try {
    return { ok: true, sample: extract(await response.json(), responseField) };
  } catch (err) {
    return {
      ok: false,
      code: "bad_shape",
      message:
        err instanceof ProbeShapeError
          ? err.message
          : "The endpoint answered 200 but the body was not valid JSON.",
    };
  }
}
