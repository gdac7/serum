import type { Router } from "express";
import { autodanRouter } from "./autodan/routes";

/** One red-team technique: its routes, and how it introduces itself. */
export interface ApproachDef {
  /** URL segment and stored `runs.approach` value. Never change it in place. */
  id: string;
  name: string;
  description: string;
  router: Router;
}

export const APPROACHES: ApproachDef[] = [
  {
    id: "autodan",
    name: "AutoDAN-Turbo",
    description:
      "Discovers and refines jailbreak strategies against a target through warm-up, lifelong-learning, and evaluate phases.",
    router: autodanRouter,
  },
];

export const APPROACH_IDS = APPROACHES.map((a) => a.id);
