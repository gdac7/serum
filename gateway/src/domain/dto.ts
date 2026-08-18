import { z } from "zod";
import { isPublicHttpsUrl } from "../infra/url-guard";

export const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "password must be at least 8 characters"),
});

export type Credentials = z.infer<typeof credentialsSchema>;

// Shared by createRunSchema and registerTargetSchema: both carry the same
// target-config shape, and kind:"api" needs the same fields validated either way.
function refineApiTarget(
  val: { kind: string; endpoint_url?: string; api_key_env?: string },
  ctx: z.RefinementCtx,
) {
  if (val.kind !== "api") return;
  if (!val.api_key_env) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["api_key_env"],
      message: "api_key_env is required for kind:api",
    });
  }
  if (!val.endpoint_url) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endpoint_url"],
      message: "endpoint_url is required for kind:api",
    });
  } else if (!isPublicHttpsUrl(val.endpoint_url)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endpoint_url"],
      message: "endpoint_url must be https and not a private/internal host",
    });
  }
}

export const createRunSchema = z
  .object({
    kind: z.enum(["local", "api"]).default("local"),
    model_name: z.string().min(1),
    phases: z.array(z.enum(["warmup", "lifelong", "evaluate"])).min(1),
    // Either an explicit dataset or a named standard one (with a percentage).
    dataset: z.array(z.string().min(1)).default([]),
    standard_dataset: z.enum(["harmbench"]).optional(),
    standard_dataset_percent: z.number().int().min(1).max(100).optional(),
    fresh_library: z.boolean().default(false),
    load_4_bits: z.boolean().default(false),
    endpoint_url: z.string().optional(),
    api_key: z.string().optional(),
    api_key_env: z.string().optional(),
  })
  .superRefine(refineApiTarget)
  .superRefine((val, ctx) => {
    if (val.standard_dataset) {
      if (val.standard_dataset_percent === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["standard_dataset_percent"],
          message: "standard_dataset_percent is required with standard_dataset",
        });
      }
    } else if (val.dataset.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dataset"],
        message: "provide a dataset or select a standard one",
      });
    }
  });

export type CreateRunInput = z.infer<typeof createRunSchema>;

// Registers a target with no attack attached — unlike createRunSchema, which
// always starts an AutoDAN-Turbo run once the target is loaded.
export const registerTargetSchema = z
  .object({
    kind: z.enum(["local", "api"]).default("local"),
    model_name: z.string().min(1),
    load_4_bits: z.boolean().default(false),
    endpoint_url: z.string().optional(),
    api_key: z.string().optional(),
    api_key_env: z.string().optional(),
  })
  .superRefine(refineApiTarget);

export type RegisterTargetInput = z.infer<typeof registerTargetSchema>;

export const chatSchema = z.object({
  message: z.string().min(1),
  system_prompt: z.string().optional(),
  max_tokens: z.number().int().min(1).max(4096).optional(),
  temperature: z.number().min(0).max(2).optional(),
});

export type ChatInput = z.infer<typeof chatSchema>;
