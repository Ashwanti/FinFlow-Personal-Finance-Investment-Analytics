import { Navigate, Outlet, useLocation } from "react-router";

import { Spinner } from "../components/Spinner";
import { useAuth } from "./AuthContext";

/**
 * Both guards wait for the session restore to finish first.
 *
 * Deciding before it settles would redirect a signed-in user to the login
 * screen every time they reloaded the page — the token is gone from memory,
 * but the cookie has not been tried yet.
 */
export function RequireAuth() {
  const { isAuthenticated, isRestoring } = useAuth();
  const location = useLocation();

  if (isRestoring) return <Spinner label="Restoring your session" />;

  // Remember where they were headed so login can send them back there.
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location }} />;

  return <Outlet />;
}

/** For /login and /register: an already-signed-in user has no business there. */
export function RequireGuest() {
  const { isAuthenticated, isRestoring } = useAuth();

  if (isRestoring) return <Spinner label="Restoring your session" />;
  if (isAuthenticated) return <Navigate to="/" replace />;

  return <Outlet />;
}
