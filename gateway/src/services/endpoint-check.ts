import { HttpError } from "../domain/errors";
import { probeEndpoint } from "../infra/endpoint-probe";

interface ApiTargetInput {
  kind: string;
  endpoint_url?: string | null;
  api_key?: string | null;
  prompt_field?: string | null;
  response_field?: string | null;
}

// Both entry points that accept a target config (POST /targets, POST /runs)
// gate on this, so an endpoint nobody can reach never reaches the service.
export async function assertEndpointReachable(input: ApiTargetInput): Promise<void> {
  if (input.kind !== "api" || !input.endpoint_url) return;

  const result = await probeEndpoint(input.endpoint_url, {
    apiKey: input.api_key ?? undefined,
    promptField: input.prompt_field ?? undefined,
    responseField: input.response_field ?? undefined,
  });

  if (!result.ok) {
    throw new HttpError(400, result.message);
  }
}
