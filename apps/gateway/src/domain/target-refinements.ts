import { z } from "zod";
import { endpointUrlProblem } from "../infra/url-guard";


// Shared by createRunSchema and registerTargetSchema: both carry the same
// target-config shape, and kind:"api" needs the same fields validated either way.
// api_key is optional: an endpoint may well be unauthenticated in development.
export function refineApiTarget(
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
