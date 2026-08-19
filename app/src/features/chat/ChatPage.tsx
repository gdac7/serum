import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useAuth } from "../../shared/auth/AuthContext";
import { targetsApi, type TargetSummary } from "../../shared/api/targets";
import { streamChat } from "../../shared/api/chat";
import { ApiError } from "../../shared/api/client";
import { IconPlus, IconSend, IconTrash } from "../../shared/components/icons";
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
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [messagesByTarget, setMessagesByTarget] = useState<Record<string, ChatMessage[]>>({});
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  function loadTargets() {
    if (!token) return;
    targetsApi
      .list(token)
      .then((data) => {
        setError(null);
        setTargets(data);
        setActiveId((prev) => prev ?? data[0]?.target_id ?? null);
      })
      .catch((err) =>
        setError(
          err instanceof ApiError
            ? err.message
            : "couldn't reach the server — check the gateway is running",
        ),
      );
  }

  useEffect(loadTargets, [token]);

  // Poll any target still loading — no SSE for target status, only for run
  // progress — so its sidebar subtitle and chat readiness stay current.
  useEffect(() => {
    if (!token || !targets) return;
    // Also poll in-use targets so the "in a test" flag clears once the run ends.
    const pending = targets.filter(
      (t) => t.status === "queued" || t.status === "loading" || t.in_use,
    );
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
  const chatBlocked = activeTarget?.in_use ?? false;

  function selectTarget(id: string) {
    abortRef.current?.abort();
    setSending(false);
    setActiveId(id);
  }

  async function deleteTarget(e: MouseEvent, t: TargetSummary) {
    e.stopPropagation();
    if (!token || t.in_use) return;
    if (!window.confirm(`Delete target "${t.model_name}"? This can't be undone.`)) return;

    setDeletingId(t.target_id);
    try {
      await targetsApi.remove(token, t.target_id);
      setTargets((prev) => prev?.filter((x) => x.target_id !== t.target_id) ?? prev);
      setMessagesByTarget((prev) => {
        const { [t.target_id]: _removed, ...rest } = prev;
        return rest;
      });
      setActiveId((prev) => (prev === t.target_id ? null : prev));
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "couldn't reach the server — check the gateway is running",
      );
    } finally {
      setDeletingId(null);
    }
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
    if (!text || !activeId || !token || sending || chatBlocked) return;

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
            <div
              key={t.target_id}
              className={`list-item${t.target_id === activeId ? " is-active" : ""}`}
              style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}
            >
              <button
                type="button"
                onClick={() => selectTarget(t.target_id)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: "none",
                  border: "none",
                  padding: 0,
                  textAlign: "left",
                  cursor: "pointer",
                  color: "inherit",
                  font: "inherit",
                }}
              >
                <div className="list-item-title">{t.model_name}</div>
                <div className="list-item-subtitle">
                  {t.kind} · {t.in_use ? "in a test" : t.status}
                </div>
              </button>
              <button
                type="button"
                className="btn-ghost"
                aria-label={`Delete ${t.model_name}`}
                title={t.in_use ? "In use by an active run" : "Delete target"}
                disabled={t.in_use || deletingId === t.target_id}
                onClick={(e) => deleteTarget(e, t)}
                style={{ flexShrink: 0, opacity: t.in_use ? 0.35 : undefined }}
              >
                <IconTrash />
              </button>
            </div>
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
          {chatBlocked && (
            <div className="form-error">
              {activeTarget?.model_name} is running a security test right now. Chat is paused until
              the run finishes — it frees up automatically.
            </div>
          )}
          {activeId && !chatBlocked && activeMessages.length === 0 && (
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
            placeholder={chatBlocked ? "Chat paused — target is running a test…" : "Message the model…"}
            value={draft}
            disabled={!activeId || sending || chatBlocked}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onComposerKeyDown}
          />
          <button
            type="button"
            className="btn btn-primary btn-icon"
            aria-label="Send"
            disabled={!activeId || !draft.trim() || sending || chatBlocked}
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
