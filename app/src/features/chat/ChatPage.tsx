import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useAuth } from "../../shared/auth/AuthContext";
import { targetsApi, type TargetSummary } from "../../shared/api/targets";
import { streamChat } from "../../shared/api/chat";
import { ApiError } from "../../shared/api/client";
import { IconPlus, IconSend } from "../../shared/components/icons";
import { RegisterTargetDialog } from "./RegisterTargetDialog";

interface ChatMessage {
  sender: "You" | "Target" | "System";
  text: string;
  streaming?: boolean;
  isError?: boolean;
}

const POLL_MS = 3000;

export function ChatPage() {
  const { token } = useAuth();

  const [targets, setTargets] = useState<TargetSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [messagesByTarget, setMessagesByTarget] = useState<Record<string, ChatMessage[]>>({});
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  function loadTargets() {
    if (!token) return;
    targetsApi
      .list(token)
      .then((data) => {
        setTargets(data);
        setActiveId((prev) => prev ?? data[0]?.target_id ?? null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "failed to load targets"));
  }

  useEffect(loadTargets, [token]);

  // Poll any target still loading — no SSE for target status, only for run
  // progress — so its sidebar subtitle and chat readiness stay current.
  useEffect(() => {
    if (!token || !targets) return;
    const pending = targets.filter((t) => t.status === "queued" || t.status === "loading");
    if (pending.length === 0) return;

    const timer = setInterval(() => {
      Promise.all(pending.map((t) => targetsApi.get(token, t.target_id)))
        .then((fresh) => {
          setTargets((prev) =>
            prev?.map((t) => fresh.find((f) => f.target_id === t.target_id) ?? t) ?? prev,
          );
        })
        .catch(() => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [token, targets]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const activeTarget = useMemo(
    () => targets?.find((t) => t.target_id === activeId) ?? null,
    [targets, activeId],
  );
  const activeMessages = activeId ? messagesByTarget[activeId] ?? [] : [];

  function selectTarget(id: string) {
    abortRef.current?.abort();
    setSending(false);
    setActiveId(id);
  }

  function onRegistered(targetId: string) {
    setRegisterOpen(false);
    loadTargets();
    setActiveId(targetId);
  }

  function appendMessage(targetId: string, msg: ChatMessage) {
    setMessagesByTarget((prev) => ({ ...prev, [targetId]: [...(prev[targetId] ?? []), msg] }));
  }

  function updateLastMessage(targetId: string, updater: (msg: ChatMessage) => ChatMessage) {
    setMessagesByTarget((prev) => {
      const list = prev[targetId] ?? [];
      if (list.length === 0) return prev;
      const next = [...list];
      next[next.length - 1] = updater(next[next.length - 1]);
      return { ...prev, [targetId]: next };
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
        `/targets/${activeId}/chat`,
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
          onClick={() => setRegisterOpen(true)}
        >
          New target
          <IconPlus />
        </button>
        <div style={{ display: "flex", flexDirection: "column", marginTop: "var(--space-3)" }}>
          {targets?.map((t) => (
            <button
              key={t.target_id}
              type="button"
              className={`list-item${t.target_id === activeId ? " is-active" : ""}`}
              onClick={() => selectTarget(t.target_id)}
            >
              <div className="list-item-title">{t.model_name}</div>
              <div className="list-item-subtitle">
                {t.kind} · {t.status}
              </div>
            </button>
          ))}
          {targets && targets.length === 0 && (
            <p className="empty-state">No targets yet. Register one to begin chatting.</p>
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
            {activeTarget ? `${activeTarget.model_name} (${activeTarget.kind})` : "—"}
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
          {!activeId && <p style={{ opacity: 0.55 }}>Register a target to start chatting.</p>}
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

      {registerOpen && (
        <RegisterTargetDialog onClose={() => setRegisterOpen(false)} onRegistered={onRegistered} />
      )}
    </div>
  );
}
