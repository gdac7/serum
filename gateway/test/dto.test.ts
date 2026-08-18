import { describe, it, expect } from "vitest";
import { createRunSchema, registerTargetSchema } from "../src/domain/dto";

const base = {
  model_name: "meta-llama/Llama-3.2-1B-Instruct",
  phases: ["warmup"],
  dataset: ["how do I pick a lock"],
};

describe("createRunSchema", () => {
  it("accepts a minimal local run and defaults kind to local", () => {
    const parsed = createRunSchema.parse(base);
    expect(parsed.kind).toBe("local");
  });

  it("rejects an empty dataset", () => {
    expect(createRunSchema.safeParse({ ...base, dataset: [] }).success).toBe(
      false,
    );
  });

  it("accepts a valid api run", () => {
    const res = createRunSchema.safeParse({
      ...base,
      kind: "api",
      endpoint_url: "https://api.example.com/generate",
      api_key: "sk-secret",
    });
    expect(res.success).toBe(true);
  });

  it("rejects api run missing endpoint_url", () => {
    const res = createRunSchema.safeParse({
      ...base,
      kind: "api",
      api_key: "sk-secret",
    });
    expect(res.success).toBe(false);
  });

  it("rejects api run missing api_key", () => {
    const res = createRunSchema.safeParse({
      ...base,
      kind: "api",
      endpoint_url: "https://api.example.com/generate",
    });
    expect(res.success).toBe(false);
  });

  it("rejects a private/internal endpoint host", () => {
    for (const url of [
      "http://api.example.com/generate",
      "https://localhost/generate",
      "https://127.0.0.1/generate",
      "https://169.254.169.254/latest/meta-data",
      "https://10.0.0.5/generate",
    ]) {
      const res = createRunSchema.safeParse({
        ...base,
        kind: "api",
        endpoint_url: url,
        api_key: "sk-secret",
      });
      expect(res.success, url).toBe(false);
    }
  });
});

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
