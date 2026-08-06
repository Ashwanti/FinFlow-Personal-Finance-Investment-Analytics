import { Route, Routes } from "react-router";

import { RequireAuth, RequireGuest } from "./auth/RouteGuards";
import { Layout } from "./components/Layout";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { RegisterPage } from "./pages/RegisterPage";

export function App() {
  return (
    <Routes>
      <Route element={<RequireGuest />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>

      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route
            path="transactions"
            element={
              <PlaceholderPage
                title="Transactions"
                endpoint="GET /api/transactions"
                note="Filtering, pagination and transfers are all supported."
              />
            }
          />
          <Route
            path="accounts"
            element={<PlaceholderPage title="Accounts" endpoint="GET /api/accounts" />}
          />
          <Route
            path="budgets"
            element={<PlaceholderPage title="Budgets" endpoint="GET /api/budgets/overview" />}
          />
          <Route
            path="portfolio"
            element={
              <PlaceholderPage
                title="Portfolio"
                endpoint="GET /api/investments/portfolio"
                note="Positions, allocation and XIRR are already computed."
              />
            }
          />
        </Route>
      </Route>

      <Route
        path="*"
        element={
          <div className="auth-page">
            <div className="auth-card">
              <h1>Page not found</h1>
              <p className="muted">That route does not exist.</p>
              <a className="btn btn-primary btn-block" href="/">
                Back to the dashboard
              </a>
            </div>
          </div>
        }
      />
    </Routes>
  );
}
