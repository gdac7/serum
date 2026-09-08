import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./shared/auth/AuthContext";
import { ProtectedLayout } from "./shared/components/ProtectedLayout";
import { APPROACHES } from "./approaches/registry";
import { LoginPage } from "./features/auth/LoginPage";
import { ChatPage } from "./features/chat/ChatPage";
import { ApproachPickerPage } from "./features/runs/ApproachPickerPage";
import { ResultsPage } from "./features/results/ResultsPage";
import { TargetsPage } from "./features/targets/TargetsPage";

function LoginRoute() {
  const { token } = useAuth();
  if (token) return <Navigate to="/chat" replace />;
  return <LoginPage />;
}

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route element={<ProtectedLayout />}>
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/targets" element={<TargetsPage />} />
            {/* Shared across approaches: the picker, and the run list every
                approach's runs show up in. */}
            <Route path="/security-testing" element={<ApproachPickerPage />} />
            <Route path="/results" element={<ResultsPage />} />
            {/* Each approach owns everything under its own id. */}
            {APPROACHES.map((approach) => (
              <Route key={approach.id} path={approach.id}>
                {approach.routes}
              </Route>
            ))}
            <Route path="/" element={<Navigate to="/chat" replace />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
