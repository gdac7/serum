import { z } from "zod";
import { isPublicHttpsUrl } from "../infra/url-guard";

export const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "password must be at least 8 characters"),
});

export type Credentials = z.infer<typeof credentialsSchema>;

export const createRunSchema = z
  .object({
    kind: z.enum(["local", "api"]).default("local"),
    model_name: z.string().min(1),
    phases: z.array(z.enum(["warmup", "lifelong", "evaluate"])).min(1),
    dataset: z.array(z.string().min(1)).min(1),
    fresh_library: z.boolean().default(false),
    load_4_bits: z.boolean().default(false),
    endpoint_url: z.string().optional(),
    api_key: z.string().optional(),
    api_key_env: z.string().optional(),
  })
  .superRefine((val, ctx) => {
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
  });

export type CreateRunInput = z.infer<typeof createRunSchema>;
