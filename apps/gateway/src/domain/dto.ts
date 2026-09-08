import { z } from "zod";
import { endpointUrlProblem } from "../infra/url-guard";
import { refineApiTarget } from "./target-refinements";

export const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "password must be at least 8 characters"),
});

export type Credentials = z.infer<typeof credentialsSchema>;



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
