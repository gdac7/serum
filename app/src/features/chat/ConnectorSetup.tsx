import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../shared/auth/AuthContext";
import { targetsApi, type ConnectorStatus, type ProbeResult } from "../../shared/api/targets";
import { ApiError } from "../../shared/api/client";

export function ConnectorSetup({ targetId, onDone }: { targetId: string; onDone: () => void }) {
  const { token } = useAuth();
  const [command, setCommand] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnectorStatus | null>(null);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const issued = useRef(false);

  // Issuing rotates the token, invalidating any connector already running for
  // this target, so it must happen once rather than on every render.
  useEffect(() => {
    if (!token || issued.current) return;
    issued.current = true;
    targetsApi
      .issueConnector(token, targetId)
      .then((res) => setCommand(res.command))
      .catch((err) => setError(err instanceof ApiError ? err.message : "could not issue a token"));
  }, [token, targetId]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const poll = () =>
      targetsApi
        .connectorStatus(token, targetId)
        .then((s) => !cancelled && setStatus(s))
        .catch(() => {});
    poll();
    const timer = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [token, targetId]);

  async function copy() {
    if (!command) return;
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function testConnection() {
    if (!token) return;
    setTesting(true);
    setProbe(null);
    try {
      setProbe(await targetsApi.test(token, targetId));
    } catch (err) {
      setProbe({
        ok: false,
        code: "request_failed",
        message: err instanceof ApiError ? err.message : "could not test the connector",
      });
    } finally {
      setTesting(false);
    }
  }

  return (
    <>
      <div className="dialog-title">Connect your model</div>
      <div className="dialog-body" style={{ display: "grid", gap: "var(--space-3)" }}>
        <p style={{ margin: 0, fontSize: 13 }}>
          Run <code>redteam-connect.py</code> on any machine that can reach your model — its own
          server, or anything else on the same network. It only makes outgoing requests, so no
          firewall change or open port is needed, and it needs Python 3 and nothing else.
        </p>

        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
          <a className="btn btn-secondary" href="/connector/redteam-connect.py" download>
            Download the script
          </a>
        </div>

        {error && <div className="form-error">{error}</div>}

        {command && (
          <div className="field">
            <label>Run this on that machine</label>
            <pre className="code-block">{command}</pre>
            <button type="button" className="btn btn-secondary" onClick={copy}>
              {copied ? "Copied" : "Copy command"}
            </button>
            <p className="form-hint">
              The token appears only here. If you lose it, open this dialog again to issue a new
              one. It has to keep running for the whole test — on a server, start it under
              <code> nohup</code> or systemd rather than a bare shell.
            </p>
          </div>
        )}

        <div className="field">
          <label>Connector</label>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <span className={status?.online ? "status-dot status-dot-on" : "status-dot"} />
            <span style={{ fontSize: 13 }}>
              {status?.online
                ? "Connected"
                : status?.configured
                  ? "Waiting for the connector to start…"
                  : "No connector yet"}
            </span>
          </div>
        </div>

        {status?.online && (
          <div style={{ display: "grid", gap: "var(--space-2)" }}>
            <div>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={testConnection}
                disabled={testing}
              >
                {testing ? "Testing…" : "Send a test prompt"}
              </button>
            </div>
            {probe &&
              (probe.ok ? (
                <div className="form-note">Your model replied: “{probe.sample.slice(0, 200)}”</div>
              ) : (
                <div className="form-error">{probe.message}</div>
              ))}
          </div>
        )}
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-primary" onClick={onDone}>
          Done
        </button>
      </div>
    </>
  );
}
