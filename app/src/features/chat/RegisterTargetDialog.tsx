import { useState } from "react";
import { useAuth } from "../../shared/auth/AuthContext";
import { targetsApi, type ProbeResult, type RegisterTargetInput } from "../../shared/api/targets";
import { ApiError } from "../../shared/api/client";
import type { TargetKind } from "../../shared/types/run";
import { EndpointContract } from "../runs/EndpointContract";
import { ConnectorSetup } from "./ConnectorSetup";

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
  const [promptField, setPromptField] = useState("");
  const [responseField, setResponseField] = useState("");
  const [showContract, setShowContract] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const [connectorTargetId, setConnectorTargetId] = useState<string | null>(null);

  function payload(): RegisterTargetInput {
    if (kind === "local") {
      return { kind: "local", model_name: modelName.trim(), load_4_bits: load4Bits };
    }
    return kind === "connector"
      ? {
          kind: "connector",
          model_name: modelName.trim(),
          endpoint_url: endpointUrl.trim(),
          prompt_field: promptField.trim() || undefined,
          response_field: responseField.trim() || undefined,
        }
      : {
          kind: "api",
          model_name: modelName.trim(),
          endpoint_url: endpointUrl.trim(),
          api_key: apiKey.trim() || undefined,
          prompt_field: promptField.trim() || undefined,
          response_field: responseField.trim() || undefined,
        };
  }

  async function testConnection() {
    if (!token) return;
    setProbe(null);
    setProbing(true);
    try {
      setProbe(await targetsApi.probe(token, payload()));
    } catch (err) {
      setProbe({
        ok: false,
        code: "request_failed",
        message: err instanceof ApiError ? err.message : "could not test the endpoint",
      });
    } finally {
      setProbing(false);
    }
  }

  async function submit() {
    setError(null);
    if (!modelName.trim()) {
      setError("Model name is required.");
      return;
    }
    // Whether a private/http host is allowed is the gateway's call, not ours.
    if (kind !== "local" && !/^https?:\/\//.test(endpointUrl.trim())) {
      setError("Endpoint URL must start with http:// or https://.");
      return;
    }
    if (!token) return;

    setSubmitting(true);
    try {
      const res = await targetsApi.register(token, payload());
      if (kind === "connector") {
        setConnectorTargetId(res.target_id);
        return;
      }
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
        {connectorTargetId ? (
          <ConnectorSetup
            targetId={connectorTargetId}
            onDone={() => onRegistered(connectorTargetId)}
          />
        ) : (
          <>
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
            <label className="seg-opt">
              <input
                type="radio"
                name="target-kind"
                checked={kind === "connector"}
                onChange={() => setKind("connector")}
              />
              On my machine
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
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "var(--space-2)",
                  }}
                >
                  <label style={{ margin: 0 }}>
                    {kind === "connector" ? "Model URL on your machine" : "Endpoint URL"}
                  </label>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ fontSize: 12, padding: "2px 10px" }}
                    onClick={() => setShowContract((v) => !v)}
                  >
                    Endpoint format
                  </button>
                </div>
                {showContract && <EndpointContract />}
                <input
                  className="input"
                  type="url"
                  placeholder={
                    kind === "connector"
                      ? "http://localhost:7070/generate"
                      : "https://your-model.example.com/generate"
                  }
                  value={endpointUrl}
                  onChange={(e) => {
                    setEndpointUrl(e.target.value);
                    setProbe(null);
                  }}
                />
              </div>
              {kind === "api" && (
                <div className="field">
                  <label>API key (optional)</label>
                  <input
                    className="input"
                    type="password"
                    placeholder="bearer token, if your endpoint needs one"
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setProbe(null);
                    }}
                  />
                </div>
              )}
              <details>
                <summary style={{ cursor: "pointer", fontSize: 13 }}>Advanced</summary>
                <div className="field" style={{ marginTop: "var(--space-2)" }}>
                  <label>Request prompt field</label>
                  <input
                    className="input"
                    placeholder="input_text"
                    value={promptField}
                    onChange={(e) => {
                      setPromptField(e.target.value);
                      setProbe(null);
                    }}
                  />
                </div>
                <div className="field">
                  <label>Response text field</label>
                  <input
                    className="input"
                    placeholder="output"
                    value={responseField}
                    onChange={(e) => {
                      setResponseField(e.target.value);
                      setProbe(null);
                    }}
                  />
                </div>
              </details>
            </>
          )}

          {kind === "api" && (
            <div style={{ display: "grid", gap: "var(--space-2)" }}>
              <div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={testConnection}
                  disabled={probing || !endpointUrl.trim()}
                >
                  {probing ? "Testing…" : "Test connection"}
                </button>
              </div>
              {probe &&
                (probe.ok ? (
                  <div className="form-note">Endpoint replied: “{probe.sample.slice(0, 200)}”</div>
                ) : (
                  <div className="form-error">{probe.message}</div>
                ))}
            </div>
          )}

          {error && <div className="form-error">{error}</div>}
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={submitting}>
            {submitting ? "Registering…" : kind === "connector" ? "Continue" : "Register target"}
          </button>
        </div>
          </>
        )}
      </div>
    </div>
  );
}
