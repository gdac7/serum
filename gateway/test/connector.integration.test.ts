// Exercises the whole connector path against a real Redis and the real
// connector script: bridge -> queue -> long-poll -> local model -> reply.
// Skipped when no Redis is reachable, since it is not a unit test.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import http from "node:http";
import { spawn, ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Redis } from "ioredis";

const connectors = new Map<string, { id: string; user_id: string; target_id: string; last_seen_at: Date | null; revoked_at: Date | null; token_hash: string; created_at: Date }>();

vi.mock("../src/repositories/connector.repository", () => ({
  connectorRepository: {
    async findByTokenHash(tokenHash: string) {
      return [...connectors.values()].find((c) => c.token_hash === tokenHash && !c.revoked_at) ?? null;
    },
    async findActiveForTarget(targetId: string) {
      return [...connectors.values()].find((c) => c.target_id === targetId && !c.revoked_at) ?? null;
    },
    async touch(id: string) {
      const row = connectors.get(id);
      if (row) row.last_seen_at = new Date();
    },
    async create() {
      throw new Error("not used");
    },
    async revokeForTarget() {},
  },
}));

const TARGET_ID = "11111111-1111-1111-1111-111111111111";
const TOKEN = "ct_integration_test_token";
// The middleware looks the token up by sha256, matching connector.service.
const TOKEN_HASH = (await import("node:crypto")).createHash("sha256").update(TOKEN).digest("hex");

const BRIDGE_SECRET = process.env.BRIDGE_SECRET ?? "test-bridge-secret-16";

async function redisReachable(): Promise<boolean> {
  const client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    lazyConnect: true,
    retryStrategy: () => null,
    maxRetriesPerRequest: 1,
  });
  try {
    await client.connect();
    await client.ping();
    return true;
  } catch {
    return false;
  } finally {
    client.disconnect();
  }
}

const hasRedis = await redisReachable();

describe.skipIf(!hasRedis)("connector round trip", () => {
  let gateway: http.Server;
  let model: http.Server;
  let connector: ChildProcess;
  let gatewayUrl: string;
  let hub: typeof import("../src/infra/connector.hub");

  beforeAll(async () => {
    connectors.set("c1", {
      id: "c1",
      user_id: "u1",
      target_id: TARGET_ID,
      token_hash: TOKEN_HASH,
      last_seen_at: null,
      revoked_at: null,
      created_at: new Date(),
    });

    hub = await import("../src/infra/connector.hub");
    const { connectRouter } = await import("../src/routes/connect.routes");
    const { bridgeRouter } = await import("../src/routes/bridge.routes");
    const express = (await import("express")).default;
    const { errorHandler } = await import("../src/middleware/error.middleware");

    const app = express();
    app.use(connectRouter);
    app.use(bridgeRouter);
    app.use(errorHandler);

    // The model under test: echoes, and fails on one specific prompt so the
    // error path is covered too.
    model = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const prompt = JSON.parse(body || "{}").input_text;
        if (prompt === "explode") {
          res.writeHead(500, { "content-type": "application/json" });
          return res.end(JSON.stringify({ detail: "model exploded" }));
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ output: `echo: ${prompt}` }));
      });
    });

    await new Promise<void>((r) => model.listen(0, "127.0.0.1", r));
    gateway = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => gateway.once("listening", r));

    const modelPort = (model.address() as { port: number }).port;
    gatewayUrl = `http://127.0.0.1:${(gateway.address() as { port: number }).port}`;

    const script = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "connector",
      "redteam-connect.py",
    );
    connector = spawn("python3", [
      script,
      "--gateway", gatewayUrl,
      "--token", TOKEN,
      "--url", `http://127.0.0.1:${modelPort}/generate`,
    ]);
    connector.stderr?.on("data", (d) => console.error("[connector]", String(d).trim()));

    // Let it register its first poll, so the target counts as online.
    await new Promise((r) => setTimeout(r, 1500));
  }, 30_000);

  afterAll(async () => {
    connector?.kill();
    hub?.connectorHub.close();
    await new Promise<void>((r) => gateway?.close(() => r()));
    await new Promise<void>((r) => model?.close(() => r()));
  });

  async function bridge(prompt: string, secret = BRIDGE_SECRET) {
    const res = await fetch(`${gatewayUrl}/bridge/targets/${TARGET_ID}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({ input_text: prompt }),
    });
    return { status: res.status, body: await res.json() };
  }

  it("carries a prompt to the local model and the reply back", async () => {
    const res = await bridge("hello");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ output: "echo: hello" });
  }, 20_000);

  it("handles several prompts in sequence", async () => {
    for (const word of ["one", "two", "three"]) {
      expect((await bridge(word)).body).toEqual({ output: `echo: ${word}` });
    }
  }, 30_000);

  it("reports a failure from the local model instead of hanging", async () => {
    const res = await bridge("explode");
    expect(res.status).toBe(504);
    expect(JSON.stringify(res.body)).toContain("500");
  }, 20_000);

  it("rejects a caller without the bridge secret", async () => {
    const res = await bridge("hello", "wrong-secret");
    expect(res.status).toBe(401);
  });

  it("rejects a poll with an unknown token", async () => {
    const res = await fetch(`${gatewayUrl}/connect/poll?wait=1`, {
      headers: { authorization: "Bearer ct_not_a_real_token" },
    });
    expect(res.status).toBe(401);
  });

  it("reports no connector for a target that has none", async () => {
    const res = await fetch(`${gatewayUrl}/bridge/targets/22222222-2222-2222-2222-222222222222`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${BRIDGE_SECRET}` },
      body: JSON.stringify({ input_text: "hi" }),
    });
    expect(res.status).toBe(503);
  });
});
