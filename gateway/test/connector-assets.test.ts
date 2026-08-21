import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { CONNECTOR_ASSETS, connectorAssetPath } from "../src/infra/connector-assets";
import { connectorAssetsRouter } from "../src/routes/connector.routes";

// Calls the route's handler directly: the guard is what matters, and standing
// up a listening server to check it would not tell us anything more.
function handle(file: string) {
  const layer = connectorAssetsRouter.stack.find((l) => l.route);
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    downloaded: null as string | null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    type: vi.fn(),
    download(path: string) {
      this.downloaded = path;
    },
  };
  layer!.route!.stack[0].handle({ params: { file } } as never, res as never, vi.fn());
  return res;
}

describe("connector assets", () => {
  // The dialog tells users to download these; if they are not resolvable the
  // instruction is a dead end and the connector cannot be set up at all.
  it.each(CONNECTOR_ASSETS)("resolves %s", (name) => {
    const file = connectorAssetPath(name);
    expect(file).not.toBeNull();
    expect(readFileSync(file!, "utf8").length).toBeGreaterThan(0);
  });

  it("resolves the script to something runnable", () => {
    const source = readFileSync(connectorAssetPath("redteam-connect.py")!, "utf8");
    expect(source).toContain("--gateway");
    expect(source).toContain("--token");
    expect(source).toContain("--url");
  });
});

describe("GET /connector/:file", () => {
  it.each(CONNECTOR_ASSETS)("serves %s as a download", (name) => {
    const res = handle(name);
    expect(res.statusCode).toBe(200);
    expect(res.downloaded).toBe(connectorAssetPath(name));
  });

  // The name goes into a filesystem path, so only the two known files may pass.
  it.each(["evil.sh", "../package.json", "../../.env", ".env"])(
    "refuses %s",
    (name) => {
      const res = handle(name);
      expect(res.statusCode).toBe(404);
      expect(res.downloaded).toBeNull();
    },
  );
});
