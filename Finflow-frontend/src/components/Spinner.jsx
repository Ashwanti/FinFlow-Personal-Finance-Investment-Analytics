export function Spinner({ label = "Loading" }) {
  return (
    <div className="spinner-wrap" role="status" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      <p className="muted">{label}…</p>
    </div>
  );
}
