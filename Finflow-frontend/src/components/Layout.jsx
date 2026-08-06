import { NavLink, Outlet } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";

const NAV = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/transactions", label: "Transactions" },
  { to: "/accounts", label: "Accounts" },
  { to: "/budgets", label: "Budgets" },
  { to: "/portfolio", label: "Portfolio" },
];

export function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ₹
          </span>
          FinFlow
        </div>

        <nav aria-label="Main">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="topbar-user">
          <span className="muted">{user?.name}</span>
          <button type="button" className="btn btn-ghost" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
