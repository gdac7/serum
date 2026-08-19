import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "../src/infra/crypto";

describe("crypto", () => {
  it("round-trips a secret", () => {
    const secret = "sk-test-1234567890";
    expect(decrypt(encrypt(secret))).toBe(secret);
  });

  it("produces different ciphertext each call (random iv)", () => {
    expect(encrypt("same")).not.toBe(encrypt("same"));
  });

  it("throws on tampered ciphertext", () => {
    const blob = encrypt("secret");
    const [iv, tag, data] = blob.split(".");
    const flipped = data[0] === "A" ? "B" : "A";
    expect(() => decrypt(`${iv}.${tag}.${flipped}${data.slice(1)}`)).toThrow();
  });

  it("throws on malformed input", () => {
    expect(() => decrypt("not-a-valid-blob")).toThrow();
  });
});
