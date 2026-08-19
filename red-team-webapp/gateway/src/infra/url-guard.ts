// SSRF guard: the Python service fetches endpoint_url server-side, so block
// non-https and loopback/private/link-local hosts before a run is accepted.

import { env } from "../config/env";
import { isPrivateHost } from "./host";

export function isPublicHttpsUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  return !isPrivateHost(url.hostname);
}

/**
 * The reason `value` fails the guard, phrased for whoever typed it, or null when
 * it passes. Distinguishing the causes matters: a private host is not a policy
 * quibble, it means the address resolves to our machine rather than theirs.
 */
export function endpointUrlProblem(value: string): string | null {
  if (isAllowedEndpointUrl(value)) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return `"${value}" is not a valid URL.`;
  }
  if (isPrivateHost(url.hostname)) {
    return (
      `${url.hostname} is a private address. It is resolved on our servers, where it points ` +
      `at our own machine rather than yours, so your model is not there. The endpoint has to ` +
      `be reachable from the public internet.`
    );
  }
  if (url.protocol !== "https:") {
    return "The endpoint URL must use https — attack prompts and model responses cannot cross the internet in the clear.";
  }
  return "The endpoint URL must be an https address reachable from the public internet.";
}

/** Same guard, relaxed to http and private hosts when ALLOW_PRIVATE_ENDPOINTS is set. */
export function isAllowedEndpointUrl(value: string): boolean {
  if (!env.ALLOW_PRIVATE_ENDPOINTS) return isPublicHttpsUrl(value);
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
