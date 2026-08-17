import type { Phase, TargetKind } from "../../shared/types/run";

// The backend has exactly one red-team method (AutoDAN-Turbo); the design's
// "approach" sidebar pattern is repurposed here for the one axis that really
// does change the config shape and target lifecycle: how the target is
// reached (a model loaded in-process vs. the client's own hosted endpoint).
export interface KindDef {
  id: TargetKind;
  name: string;
  description: string;
}

export const KIND_DEFS: KindDef[] = [
  {
    id: "local",
    name: "Local model",
    description:
      "Load a Hugging Face model in-process on the service's GPU to attack directly.",
  },
  {
    id: "api",
    name: "Remote API endpoint",
    description:
      "Attack a model you already host, reached over HTTPS with your own credentials.",
  },
];

export const PHASE_OPTIONS: { id: Phase; label: string; hint: string }[] = [
  { id: "warmup", label: "Warm-up", hint: "Discover initial strategies from scratch" },
  { id: "lifelong", label: "Lifelong", hint: "Keep attacking, growing the strategy library" },
  { id: "evaluate", label: "Evaluate", hint: "Score generations against the library as-is" },
];

export interface LocalFormState {
  model_name: string;
  phases: Phase[];
  dataset: string;
  fresh_library: boolean;
  load_4_bits: boolean;
}

export interface ApiFormState {
  model_name: string;
  phases: Phase[];
  dataset: string;
  fresh_library: boolean;
  endpoint_url: string;
  api_key: string;
  api_key_env: string;
}

export const DEFAULT_LOCAL_FORM: LocalFormState = {
  model_name: "",
  phases: ["warmup"],
  dataset: "",
  fresh_library: false,
  load_4_bits: false,
};

export const DEFAULT_API_FORM: ApiFormState = {
  model_name: "",
  phases: ["warmup"],
  dataset: "",
  fresh_library: false,
  endpoint_url: "",
  api_key: "",
  api_key_env: "",
};
