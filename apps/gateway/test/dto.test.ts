import { describe, it, expect } from "vitest";
import { registerTargetSchema } from "../src/domain/dto";

const base = {
  model_name: "meta-llama/Llama-3.2-1B-Instruct",
};

describe("registerTargetSchema", () => {
  it("accepts a minimal local target and defaults kind to local", () => {
    const parsed = registerTargetSchema.parse({ model_name: base.model_name });
    expect(parsed.kind).toBe("local");
  });

  it("has no phases/dataset requirement, unlike createRunSchema", () => {
    expect(
      registerTargetSchema.safeParse({ model_name: base.model_name }).success,
    ).toBe(true);
  });

  it("rejects an api target missing endpoint_url", () => {
    const res = registerTargetSchema.safeParse({
      model_name: base.model_name,
      kind: "api",
      api_key: "sk-secret",
    });
    expect(res.success).toBe(false);
  });

  it("accepts a valid api target", () => {
    const res = registerTargetSchema.safeParse({
      model_name: base.model_name,
      kind: "api",
      endpoint_url: "https://api.example.com/generate",
      api_key: "sk-secret",
    });
    expect(res.success).toBe(true);
  });
});
