import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router";
import { AuthProvider, useAuth } from "./lib/auth";
import { MODULES } from "./lib/modules";
import AppLayout from "./components/AppLayout";
import Landing from "./pages/Landing";
import { Login, Register } from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import Onboarding from "./pages/Onboarding";
import Profile from "./pages/Profile";
import Settings from "./pages/Settings";
import ModulePlaceholder from "./pages/ModulePlaceholder";

function RequireAuth() {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex min-h-screen items-center justify-center text-ink-soft">Wird geladen …</div>;
  return user ? <Outlet /> : <Navigate to="/anmelden" replace />;
}

// Module mit eigener Seite; alle anderen zeigen vorerst die Platzhalterseite.
const BUILT = ["/app", "/app/profil", "/app/einstellungen"];

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/anmelden" element={<Login />} />
          <Route path="/registrieren" element={<Register />} />
          <Route element={<RequireAuth />}>
            <Route path="/app" element={<AppLayout />}>
              <Route index element={<Dashboard />} />
              <Route path="einrichten" element={<Onboarding />} />
              <Route path="profil" element={<Profile />} />
              <Route path="einstellungen" element={<Settings />} />
              {MODULES.filter((m) => !BUILT.includes(m.path)).map((m) => (
                <Route key={m.path} path={m.path.replace("/app/", "")} element={<ModulePlaceholder />} />
              ))}
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
