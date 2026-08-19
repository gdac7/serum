// SSRF guard: the Python service fetches endpoint_url server-side, so block
// non-https and loopback/private/link-local hosts before a run is accepted.

import { env } from "../config/env";

const PRIVATE_V4 =
  /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/;

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "::1" || h === "[::1]" || h === "::" || h === "0.0.0.0") return true;
  if (h.startsWith("[fc") || h.startsWith("[fd") || h.startsWith("[fe8")) return true;
  if (PRIVATE_V4.test(h)) return true;
  return false;
}

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
