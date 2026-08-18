import { useState } from "react";
import { useAuth } from "../../shared/auth/AuthContext";
import { targetsApi } from "../../shared/api/targets";
import { ApiError } from "../../shared/api/client";
import type { TargetKind } from "../../shared/types/run";

export function RegisterTargetDialog({
  onClose,
  onRegistered,
}: {
  onClose: () => void;
  onRegistered: (targetId: string) => void;
}) {
  const { token } = useAuth();
  const [kind, setKind] = useState<TargetKind>("local");
  const [modelName, setModelName] = useState("");
  const [load4Bits, setLoad4Bits] = useState(false);
  const [endpointUrl, setEndpointUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setError(null);
    if (!modelName.trim()) {
      setError("Model name is required.");
      return;
    }
    if (kind === "api") {
      if (!endpointUrl.trim() || !endpointUrl.startsWith("https://")) {
        setError("Endpoint URL must be https.");
        return;
      }
      if (!apiKey.trim()) {
        setError("API key is required.");
        return;
      }
    }
    if (!token) return;

    setSubmitting(true);
    try {
      const res = await targetsApi.register(
        token,
        kind === "local"
          ? { kind: "local", model_name: modelName.trim(), load_4_bits: load4Bits }
          : {
              kind: "api",
              model_name: modelName.trim(),
              endpoint_url: endpointUrl.trim(),
              api_key: apiKey.trim(),
            },
      );
      onRegistered(res.target_id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "failed to register target");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-target-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-title" id="new-target-title">
          New target
        </div>
        <div className="dialog-body" style={{ display: "grid", gap: "var(--space-3)" }}>
          <div className="seg" role="radiogroup" aria-label="Target kind">
            <label className="seg-opt">
              <input
                type="radio"
                name="target-kind"
                checked={kind === "local"}
                onChange={() => setKind("local")}
              />
              Local model
            </label>
            <label className="seg-opt">
              <input
                type="radio"
                name="target-kind"
                checked={kind === "api"}
                onChange={() => setKind("api")}
              />
              Remote API
            </label>
          </div>

          <div className="field">
            <label>Model name</label>
            <input
              className="input"
              autoFocus
              placeholder={kind === "local" ? "org/model on Hugging Face" : "label for logs"}
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
            />
          </div>

          {kind === "local" ? (
            <label className="radio" style={{ fontSize: 13 }}>
              <input type="checkbox" checked={load4Bits} onChange={(e) => setLoad4Bits(e.target.checked)} />
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
                  value={endpointUrl}
                  onChange={(e) => setEndpointUrl(e.target.value)}
                />
              </div>
              <div className="field">
                <label>API key</label>
                <input
                  className="input"
                  type="password"
                  placeholder="bearer token for your endpoint"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </div>
            </>
          )}

          {error && <div className="form-error">{error}</div>}
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={submitting}>
            {submitting ? "Registering…" : "Register target"}
          </button>
        </div>
      </div>
    </div>
  );
}
