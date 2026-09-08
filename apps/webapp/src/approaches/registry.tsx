import type { ApproachDef } from "./types";
import { autodan } from "./autodan";

// Adding an approach: build approaches/<id>/ and list it here. App.tsx and the
// picker read this; neither needs to know the approaches by name.
export const APPROACHES: ApproachDef[] = [autodan];

export function findApproach(id: string): ApproachDef | undefined {
  return APPROACHES.find((a) => a.id === id);
}
