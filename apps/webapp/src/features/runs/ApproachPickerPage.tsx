import { Navigate, useNavigate } from "react-router-dom";
import { APPROACHES } from "../../approaches/registry";

/**
 * Chooses which red-team technique to configure. With a single approach
 * registered there is nothing to choose, so it steps out of the way.
 */
export function ApproachPickerPage() {
  const navigate = useNavigate();

  if (APPROACHES.length === 1) {
    return <Navigate to={`/${APPROACHES[0].id}/security-testing`} replace />;
  }

  return (
    <main style={{ flex: 1, overflowY: "auto", padding: "var(--space-8) var(--space-4)" }}>
      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        <h1>Security testing</h1>
        <p style={{ opacity: 0.7, marginBottom: "var(--space-6)" }}>
          Pick the approach to test with. Each one has its own parameters and results.
        </p>
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          {APPROACHES.map((approach) => (
            <button
              key={approach.id}
              type="button"
              className="list-item"
              onClick={() => navigate(`/${approach.id}/security-testing`)}
            >
              <div className="list-item-title">{approach.name}</div>
              <div className="list-item-subtitle">{approach.description}</div>
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}
