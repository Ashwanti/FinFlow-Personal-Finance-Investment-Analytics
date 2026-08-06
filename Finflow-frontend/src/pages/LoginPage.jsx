import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";
import { Field } from "../components/Field";
import { ApiError } from "../lib/apiClient";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [form, setForm] = useState({ email: "", password: "" });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const update = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setMessage(null);

    try {
      await login(form);
      // Back to wherever the guard interrupted them, or the dashboard.
      navigate(location.state?.from?.pathname ?? "/", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.byField);
        // The backend deliberately gives one message for a wrong password and
        // an unknown email, so it stays a single banner rather than being
        // pinned to the email field and implying which half was wrong.
        setMessage(err.message);
      } else {
        setMessage("Could not reach the server. Is the API running?");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={onSubmit} noValidate>
        <div className="auth-head">
          <span className="brand-mark" aria-hidden="true">
            ₹
          </span>
          <h1>Welcome back</h1>
          <p className="muted">Sign in to your FinFlow account.</p>
        </div>

        {message ? (
          <p className="alert alert-error" role="alert">
            {message}
          </p>
        ) : null}

        <Field
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          value={form.email}
          onChange={update("email")}
          error={errors.email}
          required
        />

        <Field
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          value={form.password}
          onChange={update("password")}
          error={errors.password}
          required
        />

        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>

        <p className="auth-foot muted">
          New here? <Link to="/register">Create an account</Link>
        </p>
      </form>
    </div>
  );
}
