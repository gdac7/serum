import { createHash, randomBytes } from "node:crypto";
import { env } from "../config/env";
import { HttpError } from "../domain/errors";
import { connectorRepository, ConnectorRow } from "../repositories/connector.repository";
import { targetRepository, TargetRow } from "../repositories/target.repository";

const TOKEN_PREFIX = "ct_";

// A connector that has not polled within one poll cycle plus slack is treated as
// gone, so a run fails fast instead of waiting out the bridge timeout.
const ONLINE_WINDOW_MS = 60_000;

// Hashing a 256-bit random token needs no salt or work factor, unlike a password:
// there is nothing to guess and nothing to reuse across sites.
function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isOnline(connector: ConnectorRow | null): boolean {
  if (!connector || connector.revoked_at) return false;
  if (!connector.last_seen_at) return false;
  return Date.now() - connector.last_seen_at.getTime() < ONLINE_WINDOW_MS;
}

function command(token: string, target: TargetRow): string {
  const parts = [
    "python redteam-connect.py",
    `--gateway ${env.PUBLIC_BASE_URL}`,
    `--token ${token}`,
    `--url ${target.endpoint_url || "http://localhost:8000/generate"}`,
  ];
  if (target.prompt_field) parts.push(`--prompt-field ${target.prompt_field}`);
  if (target.response_field) parts.push(`--response-field ${target.response_field}`);
  return parts.join(" ");
}

async function ownedTarget(userId: string, targetId: string) {
  const target = await targetRepository.findByIdForUser(targetId, userId);
  if (!target) throw new HttpError(404, "target not found");
  if (target.kind !== "connector") {
    throw new HttpError(400, "only connector targets use a connector token");
  }
  return target;
}

export const connectorService = {
  // Replaces any existing token: it is shown once, so a user who lost theirs can
  // only get a new one, never read the old one back.
  async issue(userId: string, targetId: string) {
    const target = await ownedTarget(userId, targetId);
    const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");

    await connectorRepository.revokeForTarget(targetId);
    await connectorRepository.create(userId, targetId, hash(token));

    return { token, command: command(token, target) };
  },

  async status(userId: string, targetId: string) {
    await ownedTarget(userId, targetId);
    const connector = await connectorRepository.findActiveForTarget(targetId);
    return {
      configured: connector !== null,
      online: isOnline(connector),
      last_seen_at: connector?.last_seen_at ?? null,
    };
  },

  async revoke(userId: string, targetId: string): Promise<void> {
    await ownedTarget(userId, targetId);
    await connectorRepository.revokeForTarget(targetId);
  },

  /** Resolves a presented bearer token to its connector, or null. */
  async authenticate(token: string): Promise<ConnectorRow | null> {
    if (!token.startsWith(TOKEN_PREFIX)) return null;
    return connectorRepository.findByTokenHash(hash(token));
  },

  async onlineForTarget(targetId: string): Promise<boolean> {
    return isOnline(await connectorRepository.findActiveForTarget(targetId));
  },
};
