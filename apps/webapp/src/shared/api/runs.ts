import { apiRequest } from "./client";
import type { RunListItem } from "../types/run";

// The cross-approach run list. Everything else about a run is served under
// that run's own approach prefix -- see approaches/<id>/api.ts.
export const runsApi = {
  list: (token: string) => apiRequest<RunListItem[]>("GET", "/runs", token),
};
