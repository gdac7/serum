import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../shared/auth/AuthContext";
import { targetsApi, type ProbeResult, type TargetSummary } from "../../shared/api/targets";
import { ApiError } from "../../shared/api/client";

const PAGE_SIZE = 8;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TargetsPage() {
  const { token } = useAuth();
  const [targets, setTargets] = useState<TargetSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [testing, setTesting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ProbeResult>>({});

  // Runs from the red-team service, not from here, so it answers the question
  // that matters: whether the attack itself can reach the endpoint.
  async function testTarget(id: string) {
    if (!token) return;
    setTesting(id);
    try {
      const result = await targetsApi.test(token, id);
      setResults((r) => ({ ...r, [id]: result }));
    } catch (err) {
      setResults((r) => ({
        ...r,
        [id]: {
          ok: false,
          code: "request_failed",
          message: err instanceof ApiError ? err.message : "could not test this target",
        },
      }));
    } finally {
      setTesting(null);
    }
  }

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    targetsApi
      .list(token)
      .then((data) => {
        if (!cancelled) {
          setError(null);
          setTargets(data);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? err.message
              : "couldn't reach the server — check the gateway is running",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const pageCount = targets ? Math.max(1, Math.ceil(targets.length / PAGE_SIZE)) : 1;
  // Clamp so the list shrinking (or a stale page) never lands out of range.
  const safePage = Math.min(page, pageCount - 1);
  const visible = useMemo(
    () => targets?.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE) ?? [],
    [targets, safePage],
  );

  return (
    <main style={{ flex: 1, overflowY: "auto" }}>
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "var(--space-8) var(--space-4)" }}>
        <h1>Target configurations</h1>
        <p style={{ opacity: 0.7, marginBottom: "var(--space-6)" }}>
          Every model you've registered as a target.
        </p>

        {error && <div className="form-error">{error}</div>}
        {!error && !targets && <p className="spinner-text">Loading…</p>}
        {!error && targets && targets.length === 0 && (
          <p className="empty-state">No targets yet — register one from Chat.</p>
        )}

        {!error && targets && targets.length > 0 && (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Kind</th>
                  <th>Endpoint</th>
                  <th>4-bit</th>
                  <th>Status</th>
                  <th>Registered</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((t) => (
                  <tr key={t.target_id}>
                    <td>{t.model_name}</td>
                    <td className="text-muted">{t.kind}</td>
                    <td className="text-muted">{t.endpoint_url ?? "—"}</td>
                    <td className="text-muted">
                      {t.kind === "local" ? (t.load_4_bits ? "yes" : "no") : "—"}
                    </td>
                    <td className="text-muted">
                      {t.in_use ? "in a test" : t.status}
                      {t.error && <div className="cell-error">{t.error}</div>}
                      {results[t.target_id] &&
                        (results[t.target_id].ok ? (
                          <div className="form-note" style={{ marginTop: "var(--space-1)" }}>
                            Replied: “{(results[t.target_id] as { sample: string }).sample.slice(0, 120)}”
                          </div>
                        ) : (
                          <div className="cell-error">
                            {(results[t.target_id] as { message: string }).message}
                          </div>
                        ))}
                    </td>
                    <td className="text-muted">{formatDate(t.created_at)}</td>
                    <td>
                      {t.kind !== "local" && (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ fontSize: 12, padding: "2px 10px" }}
                          disabled={testing === t.target_id || t.in_use}
                          title={t.in_use ? "In use by an active run" : "Send a test prompt"}
                          onClick={() => testTarget(t.target_id)}
                        >
                          {testing === t.target_id ? "Testing…" : "Test"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {pageCount > 1 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "var(--space-4)",
                  marginTop: "var(--space-4)",
                }}
              >
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={safePage === 0}
                  onClick={() => setPage(safePage - 1)}
                >
                  Previous
                </button>
                <span className="text-muted" style={{ fontSize: 13 }}>
                  Page {safePage + 1} of {pageCount}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={safePage >= pageCount - 1}
                  onClick={() => setPage(safePage + 1)}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
