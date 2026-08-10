import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Page not found</h1>
        <p className="muted">That route does not exist.</p>
        {/* A router Link, not an anchor: a full page load here would drop the
            in-memory access token and force an unnecessary refresh round trip. */}
        <Link className="btn btn-primary btn-block" to="/">
          Back to the dashboard
        </Link>
      </div>
    </div>
  );
}
