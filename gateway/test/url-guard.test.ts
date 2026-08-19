import { describe, it, expect } from "vitest";
import { isAllowedEndpointUrl, isPublicHttpsUrl } from "../src/infra/url-guard";

describe("isPublicHttpsUrl", () => {
  it("accepts a public https url", () => {
    expect(isPublicHttpsUrl("https://api.example.com/generate")).toBe(true);
  });

  it("rejects non-https", () => {
    expect(isPublicHttpsUrl("http://api.example.com")).toBe(false);
  });

  it("rejects loopback, private and link-local hosts", () => {
    for (const url of [
      "https://localhost/x",
      "https://127.0.0.1/x",
      "https://10.1.2.3/x",
      "https://192.168.0.1/x",
      "https://172.16.0.1/x",
      "https://169.254.169.254/x",
      "https://svc.internal/x",
    ]) {
      expect(isPublicHttpsUrl(url), url).toBe(false);
    }
  });

  it("rejects a malformed url", () => {
    expect(isPublicHttpsUrl("not a url")).toBe(false);
  });
});

// ALLOW_PRIVATE_ENDPOINTS is unset in the test env, so the guard stays strict.
describe("isAllowedEndpointUrl", () => {
  it("defaults to the public-https guard", () => {
    expect(isAllowedEndpointUrl("https://api.example.com/generate")).toBe(true);
    expect(isAllowedEndpointUrl("https://localhost:7000/gentext/")).toBe(false);
  });
});
