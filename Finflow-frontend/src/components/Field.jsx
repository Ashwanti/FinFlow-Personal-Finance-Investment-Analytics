import { useId } from "react";

/**
 * A labelled input that can show a server-side message beneath it.
 *
 * The API returns validation errors per field, so they are rendered where the
 * mistake is rather than collected into a banner at the top of the form. The
 * error is tied to the input with aria-describedby so a screen reader reads it
 * with the field, and aria-invalid marks the field itself.
 */
export function Field({ label, error, hint, ...inputProps }) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? errorId : hint ? hintId : undefined}
        {...inputProps}
      />
      {error ? (
        <p className="field-error" id={errorId}>
          {error}
        </p>
      ) : hint ? (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
