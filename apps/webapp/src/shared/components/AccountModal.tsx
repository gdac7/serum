import { useAuth } from "../auth/AuthContext";

export function AccountModal({ onClose }: { onClose: () => void }) {
  const { user, logout } = useAuth();

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="acct-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-title" id="acct-title">
          Account
        </div>
        <div className="dialog-body">
          <div className="field">
            <label>Email</label>
            <input className="input" value={user?.email ?? ""} readOnly />
          </div>
          <div className="field" style={{ marginTop: "var(--space-3)" }}>
            <label>User ID</label>
            <input className="input" value={user?.id ?? ""} readOnly />
          </div>
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={logout}>
            Log out
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
