import { z } from "zod";
import { refineApiTarget } from "../../domain/target-refinements";

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
