import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../shared/auth/AuthContext";
import { runsApi } from "../../shared/api/runs";
import { ApiError } from "../../shared/api/client";
import { SegMulti } from "../../shared/components/SegMulti";
import { KIND_DEFS, PHASE_OPTIONS, DEFAULT_LOCAL_FORM, DEFAULT_API_FORM } from "./kinds";
import type { LocalFormState, ApiFormState } from "./kinds";
import type { CreateRunInput, Phase, TargetKind } from "../../shared/types/run";

function parseDataset(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function validate(kind: TargetKind, local: LocalFormState, api: ApiFormState): string | null {
  const form = kind === "local" ? local : api;
  if (!form.model_name.trim()) return "Model name is required.";
  if (form.phases.length === 0) return "Select at least one phase.";
  if (parseDataset(form.dataset).length === 0) return "Add at least one dataset entry.";
  if (kind === "api") {
    const a = api;
    if (!a.endpoint_url.trim()) return "Endpoint URL is required.";
    if (!a.endpoint_url.startsWith("https://")) return "Endpoint URL must be https.";
    if (!a.api_key_env.trim()) return "API key env var name is required.";
  }
  return null;
}

export function SecurityTestingPage() {
  const { token } = useAuth();
  const [selectedKind, setSelectedKind] = useState<TargetKind>("local");
  const [local, setLocal] = useState<LocalFormState>(DEFAULT_LOCAL_FORM);
  const [api, setApi] = useState<ApiFormState>(DEFAULT_API_FORM);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [createdRunId, setCreatedRunId] = useState<string | null>(null);

  const selectedDef = KIND_DEFS.find((k) => k.id === selectedKind)!;

  function selectKind(kind: TargetKind) {
    setSelectedKind(kind);
    setCreatedRunId(null);
    setError(null);
  }

  function setPhases(kind: TargetKind, phases: Phase[]) {
    if (kind === "local") setLocal((s) => ({ ...s, phases }));
    else setApi((s) => ({ ...s, phases }));
  }

  async function runTest() {
    setError(null);
    const problem = validate(selectedKind, local, api);
    if (problem) {
      setError(problem);
      return;
    }
    if (!token) return;

    const input: CreateRunInput =
      selectedKind === "local"
        ? {
            kind: "local",
            model_name: local.model_name.trim(),
            phases: local.phases,
            dataset: parseDataset(local.dataset),
            fresh_library: local.fresh_library,
            load_4_bits: local.load_4_bits,
          }
        : {
            kind: "api",
            model_name: api.model_name.trim(),
            phases: api.phases,
            dataset: parseDataset(api.dataset),
            fresh_library: api.fresh_library,
            load_4_bits: false,
            endpoint_url: api.endpoint_url.trim(),
            api_key: api.api_key || undefined,
            api_key_env: api.api_key_env.trim(),
          };

    setSubmitting(true);
    try {
      const res = await runsApi.create(token, input);
      setCreatedRunId(res.node_run_id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "failed to start the run");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="app-body">
      <aside className="sidebar" style={{ width: 260 }}>
        <div
          style={{
            padding: "var(--space-4) var(--space-4) var(--space-2)",
            fontSize: 11,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            opacity: 0.55,
          }}
        >
          Target kind
        </div>
        {KIND_DEFS.map((k) => (
          <button
            key={k.id}
            type="button"
            className={`list-item${k.id === selectedKind ? " is-active" : ""}`}
            onClick={() => selectKind(k.id)}
          >
            <div className="list-item-title">{k.name}</div>
            <div className="list-item-subtitle">{k.description}</div>
          </button>
        ))}
      </aside>

      <main style={{ flex: 1, overflowY: "auto", padding: "var(--space-8) var(--space-4)" }}>
        <div style={{ maxWidth: 560, margin: "0 auto" }}>
          <h1>{selectedDef.name}</h1>
          <p style={{ opacity: 0.7, marginBottom: "var(--space-6)" }}>{selectedDef.description}</p>

          <div style={{ display: "grid", gap: "var(--space-4)" }}>
            <div className="field">
              <label>Model name</label>
              <input
                className="input"
                placeholder={selectedKind === "local" ? "org/model on Hugging Face" : "label for logs"}
                value={selectedKind === "local" ? local.model_name : api.model_name}
                onChange={(e) =>
                  selectedKind === "local"
                    ? setLocal((s) => ({ ...s, model_name: e.target.value }))
                    : setApi((s) => ({ ...s, model_name: e.target.value }))
                }
              />
            </div>

            <div className="field">
              <label>Phases</label>
              <SegMulti
                name="phases"
                options={PHASE_OPTIONS.map(({ id, label }) => ({ id, label }))}
                value={selectedKind === "local" ? local.phases : api.phases}
                onChange={(next) => setPhases(selectedKind, next)}
              />
              <div className="form-hint">
                {PHASE_OPTIONS.filter((p) =>
                  (selectedKind === "local" ? local.phases : api.phases).includes(p.id),
                )
                  .map((p) => p.hint)
                  .join(" · ") || "Select at least one phase."}
              </div>
            </div>

            <div className="field">
              <label>Dataset</label>
              <textarea
                className="input"
                rows={4}
                placeholder="One malicious request per line"
                value={selectedKind === "local" ? local.dataset : api.dataset}
                onChange={(e) =>
                  selectedKind === "local"
                    ? setLocal((s) => ({ ...s, dataset: e.target.value }))
                    : setApi((s) => ({ ...s, dataset: e.target.value }))
                }
              />
            </div>

            <label
              className="radio"
              style={{ fontSize: 13 }}
            >
              <input
                type="checkbox"
                checked={selectedKind === "local" ? local.fresh_library : api.fresh_library}
                onChange={(e) =>
                  selectedKind === "local"
                    ? setLocal((s) => ({ ...s, fresh_library: e.target.checked }))
                    : setApi((s) => ({ ...s, fresh_library: e.target.checked }))
                }
              />
              <span className="dot" style={{ borderRadius: 0 }} />
              Fresh library (ignore this target's stored strategies)
            </label>

            <div className="hr" style={{ margin: "var(--space-2) 0" }} />
            <div style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", opacity: 0.55 }}>
              Parameters for {selectedDef.name}
            </div>

            {selectedKind === "local" ? (
              <label className="radio" style={{ fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={local.load_4_bits}
                  onChange={(e) => setLocal((s) => ({ ...s, load_4_bits: e.target.checked }))}
                />
                <span className="dot" style={{ borderRadius: 0 }} />
                Load in 4-bit
              </label>
            ) : (
              <>
                <div className="field">
                  <label>Endpoint URL</label>
                  <input
                    className="input"
                    type="url"
                    placeholder="https://your-model.example.com/generate"
                    value={api.endpoint_url}
                    onChange={(e) => setApi((s) => ({ ...s, endpoint_url: e.target.value }))}
                  />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
                  <div className="field">
                    <label>API key</label>
                    <input
                      className="input"
                      type="password"
                      value={api.api_key}
                      onChange={(e) => setApi((s) => ({ ...s, api_key: e.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label>API key env var</label>
                    <input
                      className="input"
                      placeholder="TARGET_API_KEY"
                      value={api.api_key_env}
                      onChange={(e) => setApi((s) => ({ ...s, api_key_env: e.target.value }))}
                    />
                  </div>
                </div>
              </>
            )}

            {error && <div className="form-error">{error}</div>}

            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={runTest}
              disabled={submitting}
            >
              {submitting ? "Starting…" : "Run test"}
              {!submitting && (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12h14" />
                  <path d="m12 5 7 7-7 7" />
                </svg>
              )}
            </button>

            {createdRunId && (
              <p style={{ fontSize: 13, opacity: 0.85 }}>
                Run queued. See <Link to="/results">Results</Link> for status. To probe this
                model manually instead, register it as a target from <Link to="/chat">Chat</Link>.
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
