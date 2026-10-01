import { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router";
import { LogOut, MoreHorizontal, X } from "lucide-react";
import { Logo } from "./ui";
import { MODULES } from "../lib/modules";
import { useAuth } from "../lib/auth";

// Auf dem Handy sind diese vier direkt in der unteren Leiste, der Rest unter "Mehr".
const MOBILE_MAIN = ["/app", "/app/ziele", "/app/kalender", "/app/entwicklung"];

export default function AppLayout() {
  const { logout, user } = useAuth();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);

  const doLogout = async () => {
    await logout();
    navigate("/");
  };

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition-colors ${
      isActive ? "bg-sun text-ink" : "text-ink-soft hover:bg-mist hover:text-ink"
    }`;

  return (
    <div className="min-h-screen md:grid md:grid-cols-[250px_1fr]">
      {/* Sidebar (Desktop / Tablet) */}
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-line bg-paper p-4 md:flex">
        <Link to="/app" className="px-2 py-3"><Logo /></Link>
        <nav className="mt-4 flex-1 space-y-0.5 overflow-y-auto" aria-label="Hauptnavigation">
          {MODULES.map(({ path, label, icon: Icon }) => (
            <NavLink key={path} to={path} end={path === "/app"} className={linkClass}>
              <Icon size={19} aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-line pt-3">
          <p className="truncate px-3 text-sm text-ink-soft">{user?.email}</p>
          <button onClick={doLogout} className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium text-ink-soft hover:bg-mist hover:text-ink">
            <LogOut size={19} aria-hidden="true" /> Abmelden
          </button>
        </div>
      </aside>

      {/* Inhalt */}
      <div className="min-w-0">
        <header className="sticky top-[env(safe-area-inset-top,0px)] z-20 flex items-center justify-between border-b border-line bg-paper/95 px-5 py-3 backdrop-blur md:hidden">
          <Link to="/app"><Logo /></Link>
        </header>
        <main className="mx-auto max-w-5xl px-5 pb-32 pt-6 sm:px-8 md:pb-12 md:pt-10">
          <Outlet />
        </main>
      </div>

      {/* Untere Navigation (Handy) */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-paper md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        aria-label="Hauptnavigation"
      >
        {MODULES.filter((m) => MOBILE_MAIN.includes(m.path)).map(({ path, label, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            end={path === "/app"}
            className={({ isActive }) => `flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium ${isActive ? "text-ink" : "text-ink-soft"}`}
          >
            {({ isActive }) => (
              <>
                <span className={`rounded-full px-4 py-1 ${isActive ? "bg-sun" : ""}`}><Icon size={20} aria-hidden="true" /></span>
                {label === "Meine Entwicklung" ? "Entwicklung" : label}
              </>
            )}
          </NavLink>
        ))}
        <button onClick={() => setMoreOpen(true)} className="flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium text-ink-soft">
          <span className="px-4 py-1"><MoreHorizontal size={20} aria-hidden="true" /></span>
          Mehr
        </button>
      </nav>

      {/* "Mehr"-Menü (Handy) */}
      {moreOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Alle Bereiche">
          <button className="absolute inset-0 bg-ink/40" aria-label="Menü schliessen" onClick={() => setMoreOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-paper p-5" style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom, 0px))" }}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xl font-bold">Alle Bereiche</h2>
              <button onClick={() => setMoreOpen(false)} className="rounded-full p-2 hover:bg-mist" aria-label="Schliessen"><X size={20} /></button>
            </div>
            <nav className="grid grid-cols-2 gap-1">
              {MODULES.map(({ path, label, icon: Icon }) => (
                <NavLink key={path} to={path} end={path === "/app"} className={linkClass} onClick={() => setMoreOpen(false)}>
                  <Icon size={19} aria-hidden="true" /> {label}
                </NavLink>
              ))}
              <button onClick={doLogout} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium text-ink-soft hover:bg-mist">
                <LogOut size={19} aria-hidden="true" /> Abmelden
              </button>
            </nav>
          </div>
        </div>
      )}
    </div>
  );
}
