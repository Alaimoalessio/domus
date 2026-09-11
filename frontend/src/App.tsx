import { useState, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AuthProvider, useAuth } from "./context/AuthContext";
import Admin from "./pages/Admin";
import Login from "./pages/Login";
import Recovery from "./pages/Recovery";
import Register from "./pages/Register";
import ServerSetup from "./pages/ServerSetup";
import Settings from "./pages/Settings";
import Vault from "./pages/Vault";
import { eAppNativa, leggiServer } from "./lib/server";

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  // Nell'app nativa niente funziona finche' non si sa a quale server
  // parlare: la schermata di collegamento precede tutto il resto.
  const [server, setServer] = useState(() => (eAppNativa() ? leggiServer() : "web"));
  if (!server) return <ServerSetup onDone={() => setServer(leggiServer())} />;

  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/recovery" element={<Recovery />} />
          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <Admin />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <Settings />
              </ProtectedRoute>
            }
          />
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <Vault />
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
