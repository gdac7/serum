import { env } from "../config/env";

export interface PythonHealth {
  attacker_name: string;
  summarizer_name: string;
  scorer_name: string;
  loaded_models: string[];
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${env.PYTHON_SERVICE_URL}${path}`);
  if (!res.ok) {
    throw new Error(`python ${path} responded ${res.status}`);
  }
  return (await res.json()) as T;
}

export const pythonClient = {
  health: () => getJson<PythonHealth>("/v1/health"),
};
