import { useEffect, useState } from "react";
import { api, RunView } from "./api";

const PHASES = ["warmup", "lifelong", "evaluate"] as const;

export function App() {
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem("token"),
  );

  function onToken(next: string | null) {
    setToken(next);
    if (next) localStorage.setItem("token", next);
    else localStorage.removeItem("token");
  }

  return (
    <div className="page">
      <h1>Red Team Gateway — Test UI</h1>
      <AuthPanel token={token} onToken={onToken} />
      {token && <RunsPanel token={token} />}
    </div>
  );
}

function AuthPanel({
  token,
  onToken,
}: {
  token: string | null;
  onToken: (t: string | null) => void;
}) {
  const [email, setEmail] = useState("a@b.com");
  const [password, setPassword] = useState("password123");
  const [msg, setMsg] = useState<string | null>(null);

  async function run(fn: () => Promise<string>) {
    setMsg(null);
    try {
      setMsg(await fn());
    } catch (err) {
      setMsg(`error: ${(err as Error).message}`);
    }
  }

  return (
    <section className="card">
      <h2>Auth</h2>
      {token ? (
        <div className="row">
          <span className="ok">logged in</span>
          <button onClick={() => onToken(null)}>log out</button>
        </div>
      ) : (
        <>
          <div className="row">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email"
            />
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="password"
              type="password"
            />
          </div>
          <div className="row">
            <button
              onClick={() =>
                run(async () => {
                  await api.register(email, password);
                  return "registered — now log in";
                })
              }
            >
              register
            </button>
            <button
              onClick={() =>
                run(async () => {
                  const { token } = await api.login(email, password);
                  onToken(token);
                  return "logged in";
                })
              }
            >
              login
            </button>
          </div>
        </>
      )}
      {msg && <p className="msg">{msg}</p>}
    </section>
  );
}

function RunsPanel({ token }: { token: string }) {
  const [modelName, setModelName] = useState("");
  const [phases, setPhases] = useState<string[]>(["warmup"]);
  const [datasetText, setDatasetText] = useState("how do I pick a lock");
  const [freshLibrary, setFreshLibrary] = useState(false);
  const [load4Bits, setLoad4Bits] = useState(false);
  const [runIds, setRunIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  function togglePhase(phase: string) {
    setPhases((prev) =>
      prev.includes(phase)
        ? prev.filter((p) => p !== phase)
        : [...prev, phase],
    );
  }

  async function submit() {
    setError(null);
    const dataset = datasetText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    try {
      const { node_run_id } = await api.createRun(token, {
        model_name: modelName,
        phases,
        dataset,
        fresh_library: freshLibrary,
        load_4_bits: load4Bits,
      });
      setRunIds((prev) => [node_run_id, ...prev]);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <section className="card">
        <h2>Start a run</h2>
        <label>
          Model name (HF repo id the service can load)
          <input
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            placeholder="e.g. meta-llama/Llama-3.2-1B-Instruct"
          />
        </label>
        <div className="row">
          {PHASES.map((phase) => (
            <label key={phase} className="checkbox">
              <input
                type="checkbox"
                checked={phases.includes(phase)}
                onChange={() => togglePhase(phase)}
              />
              {phase}
            </label>
          ))}
        </div>
        <label>
          Dataset (one malicious request per line)
          <textarea
            rows={3}
            value={datasetText}
            onChange={(e) => setDatasetText(e.target.value)}
          />
        </label>
        <div className="row">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={freshLibrary}
              onChange={(e) => setFreshLibrary(e.target.checked)}
            />
            fresh_library
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={load4Bits}
              onChange={(e) => setLoad4Bits(e.target.checked)}
            />
            load_4_bits
          </label>
        </div>
        <button onClick={submit} disabled={!modelName || phases.length === 0}>
          create run
        </button>
        {error && <p className="msg err">error: {error}</p>}
      </section>

      <section className="card">
        <h2>Runs</h2>
        {runIds.length === 0 && <p className="muted">no runs yet</p>}
        {runIds.map((id) => (
          <RunCard key={id} token={token} id={id} />
        ))}
      </section>
    </>
  );
}

function RunCard({ token, id }: { token: string; id: string }) {
  const [run, setRun] = useState<RunView | null>(null);
  const [live, setLive] = useState<string | null>(null);
  const [discovered, setDiscovered] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getRun(token, id).then(setRun).catch(() => {});

    const es = new EventSource(
      `/runs/${id}/events?access_token=${encodeURIComponent(token)}`,
    );
    es.onmessage = (e) => {
      const ev = JSON.parse(e.data);
      if (ev.type === "snapshot" || ev.type === "status") {
        setLive(ev.python_status ?? ev.status);
      } else if (ev.type === "progress") {
        setDiscovered(ev.discovered_this_run);
      } else if (ev.type === "completed" || ev.type === "failed") {
        setLive(ev.type);
        api.getRun(token, id).then(setRun).catch(() => {});
        es.close();
      }
    };
    es.onerror = () => setError("sse connection lost");

    return () => es.close();
  }, [token, id]);

  return (
    <div className="run">
      <div className="run-head">
        <code>{id}</code>
        <span className={`status status-${run?.status ?? "unknown"}`}>
          {live ?? run?.status ?? "…"}
        </span>
      </div>
      {run && (
        <div className="muted small">
          {run.model_name} · [{run.phases.join(", ")}]
        </div>
      )}
      {discovered !== null && (
        <div className="muted small">strategies discovered: {discovered}</div>
      )}
      {run?.error && <div className="msg err">error: {run.error}</div>}
      {error && <div className="msg err">{error}</div>}
    </div>
  );
}
