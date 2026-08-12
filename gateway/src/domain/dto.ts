import { z } from "zod";

export const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "password must be at least 8 characters"),
});

export type Credentials = z.infer<typeof credentialsSchema>;

export const createRunSchema = z.object({
  model_name: z.string().min(1),
  phases: z.array(z.enum(["warmup", "lifelong", "evaluate"])).min(1),
  dataset: z.array(z.string().min(1)).min(1),
  fresh_library: z.boolean().default(false),
  load_4_bits: z.boolean().default(false),
});

export type CreateRunInput = z.infer<typeof createRunSchema>;
