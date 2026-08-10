import { useId } from "react";

/** A labelled <select>, matching Field's error and hint handling. */
export function Select({ label, error, hint, children, ...props }) {
  const id = useId();
  const errorId = `${id}-error`;

  return (
    <div className="field">
      {label ? <label htmlFor={id}>{label}</label> : null}
      <select id={id} aria-invalid={error ? "true" : undefined} aria-describedby={error ? errorId : undefined} {...props}>
        {children}
      </select>
      {error ? (
        <p className="field-error" id={errorId}>
          {error}
        </p>
      ) : hint ? (
        <p className="field-hint">{hint}</p>
      ) : null}
    </div>
  );
}
