import type { Phase, TargetKind } from "../../shared/types/run";

// The backend has exactly one red-team method — the design's sidebar lists
// approaches; this backend has a single one, so it's always selected.
export const APPROACH = {
  name: "AutoDAN-Turbo",
  description:
    "Discovers and refines jailbreak strategies against a target through warm-up, lifelong-learning, and evaluate phases.",
};

// Target kind isn't a separate approach — it's a parameter of AutoDAN-Turbo,
// since it's the one axis that changes the config shape and target lifecycle
// (a model loaded in-process vs. the client's own hosted endpoint).
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

// Evaluate is mandatory and always appended at run creation, so it isn't a
// user-selectable training option here — only warm-up and lifelong are.
export const PHASE_OPTIONS: { id: Phase; label: string; hint: string }[] = [
  { id: "warmup", label: "Warm-up", hint: "Discover initial strategies from scratch" },
  { id: "lifelong", label: "Lifelong", hint: "Keep attacking, growing the strategy library" },
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
