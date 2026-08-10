import { useEffect, useRef } from "react";

/**
 * A dialog built on <dialog>, so the browser supplies the focus trap, the
 * backdrop, Escape-to-close and the accessibility semantics rather than us
 * reimplementing them badly.
 */
export function Modal({ open, onClose, title, children, footer }) {
  const ref = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  // Escape fires the dialog's own close event; keep React state in step.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    const handleCancel = (event) => {
      event.preventDefault();
      onClose();
    };
    dialog.addEventListener("cancel", handleCancel);
    return () => dialog.removeEventListener("cancel", handleCancel);
  }, [onClose]);

  return (
    <dialog ref={ref} className="modal" aria-label={title}>
      <div className="modal-head">
        <h2>{title}</h2>
        <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="modal-body">{children}</div>
      {footer ? <div className="modal-foot">{footer}</div> : null}
    </dialog>
  );
}
