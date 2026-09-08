import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Nav } from "./Nav";

export function ProtectedLayout() {
  const { token, loading } = useAuth();

  if (loading) {
    return (
      <div className="app-shell" style={{ display: "grid", placeItems: "center" }}>
        <p className="spinner-text">Loading…</p>
      </div>
    );
  }
  if (!token) return <Navigate to="/login" replace />;

  return (
    <div className="app-shell">
      <Nav />
      <Outlet />
    </div>
  );
}
