import { ApiError } from "../lib/apiClient";

/**
 * The part of a failure that has no field to attach to.
 *
 * Per-field messages are rendered next to their input; this covers the rest —
 * a 409 duplicate, a 429, a rule the server enforces across several fields at
 * once, or the network being down.
 */
export function FormError({ error }) {
  if (!error) return null;

  if (!(error instanceof ApiError)) {
    return (
      <p className="alert alert-error" role="alert">
        Could not reach the server. Is the API running?
      </p>
    );
  }

  // Already shown beside the inputs — repeating it here would be noise.
  if (error.fieldErrors.length > 0 && error.status === 400) return null;

  return (
    <p className="alert alert-error" role="alert">
      {error.message}
    </p>
  );
}
