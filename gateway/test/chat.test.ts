import { describe, it, expect } from "vitest";
import { chatSchema } from "../src/domain/dto";
import { escapeHtml } from "../src/infra/sanitize";

describe("chatSchema", () => {
  it("accepts a minimal message", () => {
    expect(chatSchema.parse({ message: "hi" }).message).toBe("hi");
  });

  it("rejects an empty message", () => {
    expect(chatSchema.safeParse({ message: "" }).success).toBe(false);
  });

  it("rejects out-of-range generation params", () => {
    expect(chatSchema.safeParse({ message: "hi", max_tokens: 0 }).success).toBe(false);
    expect(chatSchema.safeParse({ message: "hi", temperature: 5 }).success).toBe(false);
  });
});

describe("escapeHtml", () => {
  it("neutralizes markup in adversarial output", () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
  });

  it("escapes ampersands before other entities", () => {
    expect(escapeHtml("a & b < c")).toBe("a &amp; b &lt; c");
  });
});
