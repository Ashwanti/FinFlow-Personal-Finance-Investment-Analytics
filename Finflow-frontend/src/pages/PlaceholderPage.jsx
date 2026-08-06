/**
 * Honest stubs for the routes the nav already links to.
 *
 * The endpoints behind each of these exist and work; only the screens are
 * outstanding. Saying so beats a dead link or a blank page that reads like a
 * bug.
 */
export function PlaceholderPage({ title, endpoint, note }) {
  return (
    <div className="stack">
      <h1 className="page-title">{title}</h1>
      <div className="panel">
        <p className="empty">This screen is not built yet.</p>
        <p className="muted">
          The API behind it is ready — <code>{endpoint}</code>.{note ? ` ${note}` : ""}
        </p>
      </div>
    </div>
  );
}
