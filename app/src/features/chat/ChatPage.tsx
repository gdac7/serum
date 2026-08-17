import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../shared/auth/AuthContext";
import { runsApi, streamChat } from "../../shared/api/runs";
import { ApiError } from "../../shared/api/client";
import { IconPlus, IconSend } from "../../shared/components/icons";
import type { RunSummary } from "../../shared/types/run";

interface ChatMessage {
  sender: "You" | "Target" | "System";
  text: string;
  streaming?: boolean;
  isError?: boolean;
}

export function ChatPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(searchParams.get("run"));
  const [messagesByRun, setMessagesByRun] = useState<Record<string, ChatMessage[]>>({});
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    runsApi
      .list(token)
      .then((data) => {
        if (cancelled) return;
        setRuns(data);
        setActiveId((prev) => prev ?? data[0]?.node_run_id ?? null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "failed to load runs");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const activeRun = useMemo(
    () => runs?.find((r) => r.node_run_id === activeId) ?? null,
    [runs, activeId],
  );
  const activeMessages = activeId ? messagesByRun[activeId] ?? [] : [];

  function selectRun(id: string) {
    abortRef.current?.abort();
    setSending(false);
    setActiveId(id);
    setSearchParams({ run: id }, { replace: true });
  }

  function appendMessage(runId: string, msg: ChatMessage) {
    setMessagesByRun((prev) => ({ ...prev, [runId]: [...(prev[runId] ?? []), msg] }));
  }

  function updateLastMessage(runId: string, updater: (msg: ChatMessage) => ChatMessage) {
    setMessagesByRun((prev) => {
      const list = prev[runId] ?? [];
      if (list.length === 0) return prev;
      const next = [...list];
      next[next.length - 1] = updater(next[next.length - 1]);
      return { ...prev, [runId]: next };
    });
  }

  async function sendMessage() {
    const text = draft.trim();
    if (!text || !activeId || !token || sending) return;

    setDraft("");
    appendMessage(activeId, { sender: "You", text });
    appendMessage(activeId, { sender: "Target", text: "", streaming: true });
    setSending(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamChat(
        token,
        activeId,
        { message: text },
        (frame) => {
          if (frame.type === "status" && frame.text) {
            updateLastMessage(activeId, (m) => ({ ...m, text: frame.text ?? m.text }));
          } else if (frame.type === "token" && frame.text) {
            updateLastMessage(activeId, (m) => ({ ...m, text: m.text + frame.text, streaming: true }));
          } else if (frame.type === "done") {
            updateLastMessage(activeId, (m) => ({
              ...m,
              text: frame.text ?? m.text,
              streaming: false,
            }));
          } else if (frame.type === "error") {
            updateLastMessage(activeId, () => ({
              sender: "System",
              text: frame.error ?? "chat failed",
              isError: true,
            }));
          }
        },
        controller.signal,
      );
    } catch (err) {
      if (!controller.signal.aborted) {
        updateLastMessage(activeId, () => ({
          sender: "System",
          text: err instanceof ApiError ? err.message : "connection lost",
          isError: true,
        }));
      }
    } finally {
      setSending(false);
    }
  }

  function onComposerKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <div className="app-body">
      <aside className="sidebar" style={{ width: 280, padding: "var(--space-4)", gap: "var(--space-3)" }}>
        <button
          type="button"
          className="btn btn-secondary btn-block"
          onClick={() => navigate("/security-testing")}
        >
          New target
          <IconPlus />
        </button>
        <div style={{ display: "flex", flexDirection: "column", marginTop: "var(--space-3)" }}>
          {runs?.map((r) => (
            <button
              key={r.node_run_id}
              type="button"
              className={`list-item${r.node_run_id === activeId ? " is-active" : ""}`}
              onClick={() => selectRun(r.node_run_id)}
            >
              <div className="list-item-title">{r.model_name}</div>
              <div className="list-item-subtitle">
                {r.target_kind} · {r.status}
              </div>
            </button>
          ))}
          {runs && runs.length === 0 && (
            <p className="empty-state">No targets yet. Start one to begin chatting.</p>
          )}
        </div>
      </aside>

      <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div
          style={{
            padding: "var(--space-3) var(--space-4)",
            borderBottom: "2px solid var(--color-divider)",
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
          }}
        >
          <label style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", opacity: 0.55 }}>
            Testing model
          </label>
          <span style={{ fontSize: 14 }}>
            {activeRun ? `${activeRun.model_name} (${activeRun.target_kind})` : "—"}
          </span>
        </div>

        {error && <div className="form-error" style={{ margin: "var(--space-4)" }}>{error}</div>}

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "var(--space-6) var(--space-4)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-5)",
          }}
        >
          {activeMessages.map((msg, i) => (
            <div key={i} style={{ maxWidth: 640 }}>
              <div className="card-kicker" style={msg.isError ? { color: "var(--color-accent-700)" } : undefined}>
                {msg.sender}
              </div>
              <p style={{ margin: "var(--space-1) 0 0" }}>
                {msg.text}
                {msg.streaming && <span className="typing-cursor" />}
              </p>
            </div>
          ))}
          {activeId && activeMessages.length === 0 && (
            <p style={{ opacity: 0.55 }}>
              Send a message to test this model. Loading it may take a minute the first time.
            </p>
          )}
          {!activeId && <p style={{ opacity: 0.55 }}>Select or start a target to chat.</p>}
        </div>

        <div
          style={{
            borderTop: "2px solid var(--color-divider)",
            padding: "var(--space-4)",
            display: "flex",
            gap: "var(--space-3)",
            alignItems: "flex-end",
          }}
        >
          <textarea
            className="input"
            rows={2}
            style={{ flex: 1, resize: "none" }}
            placeholder="Message the model…"
            value={draft}
            disabled={!activeId || sending}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onComposerKeyDown}
          />
          <button
            type="button"
            className="btn btn-primary btn-icon"
            aria-label="Send"
            disabled={!activeId || !draft.trim() || sending}
            onClick={sendMessage}
          >
            <IconSend />
          </button>
        </div>
      </main>
    </div>
  );
}
