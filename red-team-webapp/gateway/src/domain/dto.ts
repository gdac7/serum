import { z } from "zod";
import { endpointUrlProblem } from "../infra/url-guard";

export const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "password must be at least 8 characters"),
});

export type Credentials = z.infer<typeof credentialsSchema>;

// Shared by createRunSchema and registerTargetSchema: both carry the same
// target-config shape, and kind:"api" needs the same fields validated either way.
// api_key is optional: an endpoint may well be unauthenticated in development.
function refineApiTarget(
  val: { kind: string; endpoint_url?: string; api_key?: string },
  ctx: z.RefinementCtx,
) {
  // A connector carries no endpoint here: registering one supplies it (see
  // refineConnectorEndpoint) and a run names the registered target instead, so
  // there is nothing about it for the shared refinement to check.
  if (val.kind !== "api") return;
  if (!val.endpoint_url) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endpoint_url"],
      message: "endpoint_url is required for kind:api",
    });
  } else {
    const problem = endpointUrlProblem(val.endpoint_url);
    if (problem) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endpoint_url"], message: problem });
    }
  }
}

export const createRunSchema = z
  .object({
    kind: z.enum(["local", "api", "connector"]).default("local"),
    model_name: z.string().min(1),
    // Identifies which registered connector target the run attacks; a connector
    // is a standing registration, not something a run can define inline.
    connector_target_id: z.string().uuid().optional(),
    phases: z.array(z.enum(["warmup", "lifelong", "evaluate"])).min(1),
    // Either an explicit dataset or a named standard one (with a percentage).
    dataset: z.array(z.string().min(1)).default([]),
    standard_dataset: z.enum(["harmbench"]).optional(),
    standard_dataset_percent: z.number().int().min(1).max(100).optional(),
    fresh_library: z.boolean().default(false),
    load_4_bits: z.boolean().default(false),
    endpoint_url: z.string().optional(),
    api_key: z.string().optional(),
    // Endpoints that don't use the default "input_text" in / "output" out keys.
    prompt_field: z.string().min(1).optional(),
    response_field: z.string().min(1).optional(),
  })
  .superRefine(refineApiTarget)
  .superRefine((val, ctx) => {
    if (val.kind === "connector" && !val.connector_target_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["connector_target_id"],
        message: "connector_target_id is required for kind:connector",
      });
    }
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
// Registration is where a connector's endpoint is supplied: the address on the
// user's own machine, which only their connector ever calls, so the
// public-reachability guard deliberately does not apply to it.
function refineConnectorEndpoint(
  val: { kind: string; endpoint_url?: string },
  ctx: z.RefinementCtx,
) {
  if (val.kind !== "connector") return;
  if (!val.endpoint_url) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endpoint_url"],
      message: "endpoint_url is required: the address your connector calls on your machine",
    });
  } else if (!/^https?:\/\/./.test(val.endpoint_url)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endpoint_url"],
      message: "endpoint_url must start with http:// or https://",
    });
  }
}

export const registerTargetSchema = z
  .object({
    kind: z.enum(["local", "api", "connector"]).default("local"),
    model_name: z.string().min(1),
    load_4_bits: z.boolean().default(false),
    endpoint_url: z.string().optional(),
    api_key: z.string().optional(),
    // Endpoints that don't use the default "input_text" in / "output" out keys.
    prompt_field: z.string().min(1).optional(),
    response_field: z.string().min(1).optional(),
  })
  .superRefine(refineApiTarget)
  .superRefine(refineConnectorEndpoint);

export type RegisterTargetInput = z.infer<typeof registerTargetSchema>;

// Probing asks "does this endpoint answer", which needs no model name -- the
// label is only meaningful once a target is being saved.
export const probeTargetSchema = z
  .object({
    kind: z.enum(["local", "api", "connector"]).default("api"),
    endpoint_url: z.string().optional(),
    api_key: z.string().optional(),
    prompt_field: z.string().min(1).optional(),
    response_field: z.string().min(1).optional(),
  })
  .superRefine(refineApiTarget);

export type ProbeTargetInput = z.infer<typeof probeTargetSchema>;

export const chatSchema = z.object({
  message: z.string().min(1),
  system_prompt: z.string().optional(),
  max_tokens: z.number().int().min(1).max(4096).optional(),
  temperature: z.number().min(0).max(2).optional(),
});

export type ChatInput = z.infer<typeof chatSchema>;
