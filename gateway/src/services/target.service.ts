import { HttpError } from "../domain/errors";
import { targetRepository, TargetRow } from "../repositories/target.repository";
import { runRepository } from "../repositories/run.repository";
import { redTeamClient, RedTeamServiceError, TargetConfig } from "../infra/redteam.client";
import { encrypt, decrypt } from "../infra/crypto";
import { ensureTargetLoaded } from "./target-loader";
import { probeEndpoint, ProbeResult } from "../infra/endpoint-probe";
import { probeFromService } from "./service-probe";
import { connectorTargetConfig } from "../domain/target-config";
import type { ProbeTargetInput, RegisterTargetInput } from "../domain/dto";

export type TargetBusyReason = "active_run" | "gpu_busy";

// A local target can be unavailable either because it owns the active run or
// because another run holds the single GPU. Keep those cases distinct so the
// UI never claims the wrong model is being tested.
function shapeTarget(t: TargetRow, busyReason: TargetBusyReason | null = null) {
  return {
    target_id: t.id,
    kind: t.kind,
    model_name: t.model_name,
    endpoint_url: t.endpoint_url,
    prompt_field: t.prompt_field,
    response_field: t.response_field,
    load_4_bits: t.load_4_bits,
    status: t.status,
    error: t.error,
    in_use: busyReason !== null,
    busy_reason: busyReason,
    created_at: t.created_at,
    updated_at: t.updated_at,
  };
}

// endpoint_url on a connector row is the address on the *user's* machine, which
// only their connector can reach; what the service gets is the bridge instead.
function configFromRow(t: TargetRow): TargetConfig {
  if (t.kind === "connector") {
    return connectorTargetConfig(t.model_name, t.id);
  }
  return t.kind === "api"
    ? {
        kind: "api",
        model_name: t.model_name,
        endpoint_url: t.endpoint_url ?? undefined,
        api_key: t.encrypted_api_key ? decrypt(t.encrypted_api_key) : undefined,
        prompt_field: t.prompt_field ?? undefined,
        response_field: t.response_field ?? undefined,
      }
    : { kind: "local", model_name: t.model_name, load_4_bits: t.load_4_bits };
}

export function targetBusyReason(
  t: TargetRow,
  activeTargetIds: Set<string>,
  gpuBusy: boolean,
): TargetBusyReason | null {
  if (t.python_target_id != null && activeTargetIds.has(t.python_target_id)) {
    return "active_run";
  }
  if (t.kind === "local" && gpuBusy) return "gpu_busy";
  return null;
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
      promptField: input.prompt_field ?? null,
      responseField: input.response_field ?? null,
      load4Bits: input.load_4_bits,
    });

    await redTeamClient.createClient(userId);
    const target = await redTeamClient.registerTarget(userId, configFromRow(row));
    await targetRepository.setPythonTargetId(row.id, target.target_id);
    await targetRepository.setStatus(row.id, target.status);

    // Verified from the service, which is the only host whose answer counts:
    // it and the gateway resolve names differently, and for a container-hosted
    // endpoint an address that works here may not work there, or the reverse.
    // A connector target is excluded: it only becomes reachable once its token
    // is issued and the connector starts, both of which happen after this
    // returns, so probing here would delete every connector target ever made.
    // `test()` is where a connector's reachability is checked instead.
    if (row.kind === "api") {
      const reachable = await probeFromService(userId, target.target_id);
      if (!reachable.ok) {
        await targetRepository.delete(row.id, userId);
        throw new HttpError(400, reachable.message);
      }
    }

    return { target_id: row.id, status: target.status };
  },

  async list(userId: string) {
    const rows = await targetRepository.listByUser(userId);
    const active = new Set(await runRepository.activeTargetIds(userId));
    const gpuBusy = await runRepository.hasActiveRun(userId);
    return rows.map((t) => shapeTarget(t, targetBusyReason(t, active, gpuBusy)));
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
    const active = new Set(await runRepository.activeTargetIds(userId));
    const gpuBusy = await runRepository.hasActiveRun(userId);
    return shapeTarget(
      { ...row, status: health.status, error: health.error ?? null },
      targetBusyReason(row, active, gpuBusy),
    );
  },

  // Refuses while an active run holds the target (mirrors the `in_use` flag
  // `list`/`refresh` compute) rather than ripping GPU weights out from under
  // it. Deleting Python's registration never touches the strategy library --
  // that's keyed by target_key, not target_id, so it survives.
  async remove(userId: string, id: string): Promise<void> {
    const row = await targetRepository.findByIdForUser(id, userId);
    if (!row) throw new HttpError(404, "target not found");

    if (row.python_target_id) {
      const active = await runRepository.activeTargetIds(userId);
      if (active.includes(row.python_target_id)) {
        throw new HttpError(409, "target is in use by an active run");
      }
      try {
        await redTeamClient.deleteTarget(userId, row.python_target_id);
      } catch (err) {
        if (!(err instanceof RedTeamServiceError && err.status === 404)) throw err;
      }
    }

    await targetRepository.delete(id, userId);
  },

  // Probes a config the user has typed but not saved, so the form can report
  // a broken endpoint without leaving a dead target row behind.
  async probe(input: ProbeTargetInput): Promise<ProbeResult> {
    if (input.kind !== "api" || !input.endpoint_url) {
      return { ok: false, code: "dns", message: "only kind:api targets have an endpoint to test" };
    }
    return probeEndpoint(input.endpoint_url, {
      apiKey: input.api_key,
      promptField: input.prompt_field,
      responseField: input.response_field,
    });
  },

  // Re-checks a saved target. A registered endpoint can go down later, and the
  // service's view of it never changes once loaded -- it only holds a config.
  async test(userId: string, id: string): Promise<ProbeResult> {
    const row = await targetRepository.findByIdForUser(id, userId);
    if (!row) throw new HttpError(404, "target not found");
    if (row.kind === "local") {
      throw new HttpError(400, "a local target has no endpoint to test");
    }
    if (row.kind === "api" && !row.endpoint_url) {
      throw new HttpError(400, "target has no endpoint to test");
    }

    // Probing from here answers the wrong question: the gateway and the service
    // resolve names on different hosts, so an endpoint we can reach may still be
    // unreachable from where the attack actually runs. Ask the service instead --
    // for a connector this also walks the bridge, the queue and the user's agent.
    const { clientId, targetId } = await this.ensureLoaded(row);
    const result = await probeFromService(clientId, targetId);

    await targetRepository.setStatus(
      row.id,
      result.ok ? row.status : "failed",
      result.ok ? null : result.message,
    );
    return result;
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
