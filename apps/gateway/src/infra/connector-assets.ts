import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// The connector ships with the gateway because the gateway is what hands it to
// users. Two layouts hold it: sibling directories in the repo, and copied into
// the package in the container image, whose build context is the repo root.
const CANDIDATES = [
  path.join(packageRoot, "..", "connector"),
  path.join(packageRoot, "connector"),
];

export const CONNECTOR_ASSETS = ["redteam-connect.py", "README.md"] as const;

export type ConnectorAsset = (typeof CONNECTOR_ASSETS)[number];

/** Absolute path of a connector file, or null when it isn't in the image. */
export function connectorAssetPath(name: ConnectorAsset): string | null {
  for (const dir of CANDIDATES) {
    const candidate = path.join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
