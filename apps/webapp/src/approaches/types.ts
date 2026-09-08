import type { ComponentType, ReactNode } from "react";

/** One red-team technique: how it introduces itself, and the routes it owns. */
export interface ApproachDef {
  /** URL segment and the `approach` value the gateway stores on a run. */
  id: string;
  name: string;
  description: string;
  /** Rendered inside <Route path={id}>, so every path here is relative. */
  routes: ReactNode;
  /**
   * Live run events, if the approach streams them. The cross-approach run
   * list uses this to update a row the moment it finishes; without it the
   * row still reconciles on the list's poll, just later.
   */
  subscribeRunEvents?: (
    token: string,
    runId: string,
    onEvent: (data: Record<string, unknown>) => void,
  ) => () => void;
  /** Detail view the run list opens for a row belonging to this approach. */
  RunDetailDialog?: ComponentType<{ runId: string; onClose: () => void }>;
}
