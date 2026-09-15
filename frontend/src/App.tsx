import { useState, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AuthProvider, useAuth } from "./context/AuthContext";
import { VaultProvider } from "./context/VaultContext";
import Admin from "./pages/Admin";
import Codici from "./pages/Codici";
import Lock from "./pages/Lock";
import Login from "./pages/Login";
import Recovery from "./pages/Recovery";
import Register from "./pages/Register";
import ServerSetup from "./pages/ServerSetup";
import Settings from "./pages/Settings";
import Vault from "./pages/Vault";
import { eAppNativa, leggiServer } from "./lib/server";

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, locked } = useAuth();
  if (!isAuthenticated && locked) return <Navigate to="/lock" replace />;
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
      <VaultProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/lock" element={<Lock />} />
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
            path="/codici"
            element={
              <ProtectedRoute>
                <Codici />
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
      </VaultProvider>
    </AuthProvider>
  );
}
