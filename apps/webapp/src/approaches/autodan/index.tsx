import { Route } from "react-router-dom";
import type { ApproachDef } from "../types";
import { subscribeRunEvents } from "./api";
import { ConfigPage } from "./ConfigPage";
import { RunDetailDialog } from "./results/RunDetailDialog";
import { MonitorPage } from "./results/MonitorPage";
import { RunResultsPage } from "./results/RunResultsPage";
import { RunStrategiesPage } from "./results/RunStrategiesPage";
import { RunTranscriptPage } from "./results/RunTranscriptPage";

export const autodan: ApproachDef = {
  id: "autodan",
  name: "AutoDAN-Turbo",
  description:
    "Discovers and refines jailbreak strategies against a target through warm-up, lifelong-learning, and evaluate phases.",
  subscribeRunEvents,
  RunDetailDialog,
  routes: (
    <>
      <Route path="security-testing" element={<ConfigPage />} />
      <Route path="results/:id" element={<RunResultsPage />} />
      <Route path="results/:id/monitor" element={<MonitorPage />} />
      <Route path="results/:id/transcript" element={<RunTranscriptPage />} />
      <Route path="results/:id/strategies" element={<RunStrategiesPage />} />
    </>
  ),
};
