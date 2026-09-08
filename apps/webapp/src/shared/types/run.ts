// Shapes that hold for every approach. Anything an approach's own parameters
// or results add lives in that approach's types (approaches/<id>/types.ts).

export type TargetKind = "local" | "api" | "connector";

export type CoarseStatus = "queued" | "running" | "completed" | "failed";

/** A row of the cross-approach run list (gateway GET /runs). */
export interface RunListItem {
  node_run_id: string;
  /** Which approach produced this run; picks the views it links into. */
  approach: string;
  status: CoarseStatus;
  model_name: string;
  target_kind: TargetKind;
  endpoint_url: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  ended_at: string | null;
}

export interface ChatFrame {
  type: "status" | "token" | "done" | "error";
  text?: string;
  error?: string;
}
