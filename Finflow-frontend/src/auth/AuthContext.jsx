import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { authApi, setAccessToken, setOnAuthLost } from "../lib/apiClient";
import { queryClient } from "../lib/queryClient";

const AuthContext = createContext(null);

/**
 * Session state for the app.
 *
 * The access token itself is not in here — it lives in the API client, so
 * nothing can accidentally render it or persist it through React state. This
 * holds only the user, and the flag saying whether the initial restore has
 * finished.
 *
 * That restore is the whole reason a memory-only token is workable: on load
 * there is no token, but the httpOnly refresh cookie survived, so one call to
 * /auth/refresh brings the session back. Until it settles the app must show
 * nothing — routing on `user === null` too early would bounce a signed-in user
 * to the login screen on every refresh.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState("restoring"); // restoring | ready

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    // Another user's data must never survive a logout in the cache.
    queryClient.clear();
  }, []);

  // Lets the API client drop the app back to signed-out when a refresh fails
  // mid-session, without importing React state into it.
  useEffect(() => {
    setOnAuthLost(() => clearSession());
    return () => setOnAuthLost(null);
  }, [clearSession]);

  useEffect(() => {
    let cancelled = false;

    authApi
      .restore()
      .then((session) => {
        if (!cancelled) setUser(session.user);
      })
      .catch(() => {
        // No cookie, or it expired. A first-time visitor lands here; it is the
        // normal path, not an error worth surfacing.
      })
      .finally(() => {
        if (!cancelled) setStatus("ready");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const adoptSession = useCallback((session) => {
    setAccessToken(session.accessToken);
    setUser(session.user);
  }, []);

  const login = useCallback(
    async (credentials) => adoptSession(await authApi.login(credentials)),
    [adoptSession]
  );

  const register = useCallback(
    async (payload) => adoptSession(await authApi.register(payload)),
    [adoptSession]
  );

  const logout = useCallback(async () => {
    try {
      // Revokes the refresh token server-side. If the call fails the local
      // session is cleared anyway — a user asking to log out must always end
      // up logged out on this device.
      await authApi.logout();
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const value = useMemo(
    () => ({
      user,
      setUser,
      isAuthenticated: Boolean(user),
      isRestoring: status === "restoring",
      login,
      register,
      logout,
    }),
    [user, status, login, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside an AuthProvider");
  return context;
}
