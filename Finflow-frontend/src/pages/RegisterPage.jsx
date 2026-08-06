import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { useAuth } from "../auth/AuthContext";
import { Field } from "../components/Field";
import { ApiError } from "../lib/apiClient";

// Mirrors the backend's rule so the user is told before a round trip, not
// after. The server still enforces it — this is a courtesy, not a check.
const PASSWORD_HINT = "At least 8 characters, with a letter and a number";

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    baseCurrency: "INR",
  });
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
      await register({
        ...form,
        // The browser knows the user's zone; sending it means their months and
        // weeks line up from the first report instead of defaulting elsewhere.
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      navigate("/", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.byField);
        // A duplicate email is a 409 with no field attached; show it plainly.
        if (err.fieldErrors.length === 0) setMessage(err.message);
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
          <h1>Create your account</h1>
          <p className="muted">Track spending, budgets and investments in one place.</p>
        </div>

        {message ? (
          <p className="alert alert-error" role="alert">
            {message}
          </p>
        ) : null}

        <Field
          label="Name"
          name="name"
          autoComplete="name"
          value={form.name}
          onChange={update("name")}
          error={errors.name}
          required
        />

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
          autoComplete="new-password"
          value={form.password}
          onChange={update("password")}
          error={errors.password}
          hint={PASSWORD_HINT}
          required
        />

        <Field
          label="Base currency"
          name="baseCurrency"
          maxLength={3}
          value={form.baseCurrency}
          onChange={update("baseCurrency")}
          error={errors.baseCurrency}
          hint="Every report is converted into this currency"
        />

        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "Creating account…" : "Create account"}
        </button>

        <p className="auth-foot muted">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
