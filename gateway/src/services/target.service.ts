import { HttpError } from "../domain/errors";
import { targetRepository, TargetRow } from "../repositories/target.repository";
import { runRepository } from "../repositories/run.repository";
import { redTeamClient, TargetConfig } from "../infra/redteam.client";
import { encrypt, decrypt } from "../infra/crypto";
import { ensureTargetLoaded } from "./target-loader";
import type { RegisterTargetInput } from "../domain/dto";

// in_use marks a target whose model is running a test right now: the run holds
// the GPU, so chat is unavailable until it finishes.
function shapeTarget(t: TargetRow, inUse = false) {
  return {
    target_id: t.id,
    kind: t.kind,
    model_name: t.model_name,
    endpoint_url: t.endpoint_url,
    load_4_bits: t.load_4_bits,
    status: t.status,
    error: t.error,
    in_use: inUse,
    created_at: t.created_at,
    updated_at: t.updated_at,
  };
}

function configFromRow(t: TargetRow): TargetConfig {
  return t.kind === "api"
    ? {
        kind: "api",
        model_name: t.model_name,
        endpoint_url: t.endpoint_url ?? undefined,
        api_key: t.encrypted_api_key ? decrypt(t.encrypted_api_key) : undefined,
      }
    : { kind: "local", model_name: t.model_name, load_4_bits: t.load_4_bits };
}

export const targetService = {
  // Registers a target with Python and starts it loading on the GPU — no
  // attack attached, unlike run creation, which always starts one right after.
  // Returns immediately with Python's initial status; the client polls
  // GET /targets/:id (or just starts a chat, which waits for it itself).
  async register(userId: string, input: RegisterTargetInput) {
    const row = await targetRepository.create({
      userId,
      kind: input.kind,
      modelName: input.model_name,
      endpointUrl: input.endpoint_url ?? null,
      encryptedApiKey: input.api_key ? encrypt(input.api_key) : null,
      load4Bits: input.load_4_bits,
    });

    await redTeamClient.createClient(userId);
    const target = await redTeamClient.registerTarget(userId, configFromRow(row));
    await targetRepository.setPythonTargetId(row.id, target.target_id);
    await targetRepository.setStatus(row.id, target.status);

    return { target_id: row.id, status: target.status };
  },

  async list(userId: string) {
    const rows = await targetRepository.listByUser(userId);
    const active = new Set(await runRepository.activeTargetIds(userId));
    return rows.map((t) => shapeTarget(t, t.python_target_id != null && active.has(t.python_target_id)));
  },

  // Re-checks Python health and syncs the local row — status may have moved
  // on since register (loaded/failed), or Python may have restarted since.
  async refresh(userId: string, id: string) {
    const row = await targetRepository.findByIdForUser(id, userId);
    if (!row) throw new HttpError(404, "target not found");
    if (!row.python_target_id) return shapeTarget(row);

    const health = await redTeamClient.getTargetHealth(userId, row.python_target_id);
    if (health.status !== row.status || (health.error ?? null) !== row.error) {
      await targetRepository.setStatus(row.id, health.status, health.error ?? null);
    }
    const active = await runRepository.activeTargetIds(userId);
    return shapeTarget(
      { ...row, status: health.status, error: health.error ?? null },
      active.includes(row.python_target_id),
    );
  },

  async loadTarget(userId: string, id: string): Promise<TargetRow> {
    const row = await targetRepository.findByIdForUser(id, userId);
    if (!row) throw new HttpError(404, "target not found");
    return row;
  },

  async ensureLoaded(
    row: TargetRow,
    onStatus?: (text: string) => void,
  ): Promise<{ clientId: string; targetId: string }> {
    const clientId = row.user_id;
    const targetId = await ensureTargetLoaded(
      clientId,
      configFromRow(row),
      row.python_target_id,
      onStatus,
    );
    if (targetId !== row.python_target_id) {
      await targetRepository.setPythonTargetId(row.id, targetId);
    }
    return { clientId, targetId };
  },
};
