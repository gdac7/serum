import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./shared/auth/AuthContext";
import { ProtectedLayout } from "./shared/components/ProtectedLayout";
import { LoginPage } from "./features/auth/LoginPage";
import { ChatPage } from "./features/chat/ChatPage";
import { SecurityTestingPage } from "./features/runs/SecurityTestingPage";
import { ResultsPage } from "./features/results/ResultsPage";

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
            <Route path="/security-testing" element={<SecurityTestingPage />} />
            <Route path="/results" element={<ResultsPage />} />
            <Route path="/" element={<Navigate to="/chat" replace />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
