/**
 * The single way this app talks to the API.
 *
 * Two responsibilities that must not be spread around:
 *
 * 1. The access token lives here, in a module variable — never localStorage.
 *    A token in localStorage is readable by any script that ends up on the
 *    page, and it survives long after the tab closes. Holding it in memory
 *    means a reload loses it, which is exactly why the refresh cookie exists.
 *
 * 2. A 401 triggers one refresh and one retry. "One" is load-bearing: without
 *    a shared in-flight promise, a dashboard firing six queries at once would
 *    send six refreshes, and since the backend rotates refresh tokens and
 *    treats a replayed one as theft, five of them would look like an attack
 *    and revoke every session the user has.
 */

// Empty in dev: requests go to /api on this origin and Vite proxies them, so
// the httpOnly refresh cookie is same-origin and simply works.
const API_BASE = import.meta.env.VITE_API_URL ?? "";

let accessToken = null;
let onAuthLost = null;

/** Shared across concurrent callers so only one refresh is ever in flight. */
let refreshPromise = null;

export const setAccessToken = (token) => {
  accessToken = token;
};
export const getAccessToken = () => accessToken;

/** Called when refreshing fails, so the app can drop back to the login screen. */
export const setOnAuthLost = (handler) => {
  onAuthLost = handler;
};

/** An API error carrying the status and the backend's per-field messages. */
export class ApiError extends Error {
  constructor(status, message, fieldErrors) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fieldErrors = fieldErrors ?? [];
  }

  /** { email: "Enter a valid email address" } — for rendering beside inputs. */
  get byField() {
    return Object.fromEntries(this.fieldErrors.map((e) => [e.field, e.message]));
  }
}

async function readBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function toError(response, body) {
  const message =
    body?.message ||
    (response.status === 429
      ? "Too many attempts. Please wait a moment and try again."
      : `Request failed (${response.status})`);
  return new ApiError(response.status, message, body?.errors);
}

async function send(path, { method = "GET", body, signal, auth = true } = {}) {
  return fetch(`${API_BASE}${path}`, {
    method,
    // Always: the refresh cookie is httpOnly, so it only travels if asked for.
    credentials: "include",
    headers: {
      ...(body !== undefined && { "Content-Type": "application/json" }),
      ...(auth && accessToken && { Authorization: `Bearer ${accessToken}` }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
    signal,
  });
}

/**
 * Exchange the refresh cookie for a new access token.
 *
 * Sent with no body at all — the cookie is the credential. The backend
 * tolerates a missing body specifically so this call works.
 */
async function refreshSession() {
  const response = await send("/api/auth/refresh", { method: "POST", auth: false });
  const body = await readBody(response);

  if (!response.ok) {
    setAccessToken(null);
    throw toError(response, body);
  }

  setAccessToken(body.data.accessToken);
  return body.data;
}

/** Coalesces concurrent refreshes into one, then clears the slot. */
function refreshOnce() {
  refreshPromise ??= refreshSession().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

/**
 * @param {string} path e.g. "/api/analytics/dashboard"
 * @returns the `data` object from the API's `{success, data}` envelope.
 */
export async function request(path, options = {}) {
  let response = await send(path, options);

  // 401 means expired or missing, not necessarily invalid. Try once.
  if (response.status === 401 && options.auth !== false && !options.isRetry) {
    try {
      await refreshOnce();
    } catch (err) {
      onAuthLost?.();
      throw err;
    }
    response = await send(path, { ...options, isRetry: true });
  }

  const body = await readBody(response);

  if (!response.ok) {
    // A second 401 means the fresh token was rejected too — the session is
    // genuinely gone, not merely stale.
    if (response.status === 401) {
      setAccessToken(null);
      onAuthLost?.();
    }
    throw toError(response, body);
  }

  return body?.data ?? body;
}

export const api = {
  get: (path, options) => request(path, { ...options, method: "GET" }),
  post: (path, body, options) => request(path, { ...options, method: "POST", body }),
  patch: (path, body, options) => request(path, { ...options, method: "PATCH", body }),
  put: (path, body, options) => request(path, { ...options, method: "PUT", body }),
  delete: (path, options) => request(path, { ...options, method: "DELETE" }),
};

// --- auth calls -------------------------------------------------------------
// auth:false on register/login/refresh: there is no token yet, and sending a
// stale one would only invite a pointless refresh round trip.

export const authApi = {
  register: (payload) =>
    request("/api/auth/register", { method: "POST", body: payload, auth: false }),

  login: (payload) => request("/api/auth/login", { method: "POST", body: payload, auth: false }),

  /** Restores a session on page load from the cookie alone. */
  restore: () => refreshOnce(),

  logout: () => request("/api/auth/logout", { method: "POST", auth: false }),

  me: () => request("/api/me"),
};
