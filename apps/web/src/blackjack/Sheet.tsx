import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

/**
 * Something laid over the table on purpose: the rules card on a phone, the
 * host's settings. Escape and the scrim close it, and focus goes back to the key
 * that opened it, so a keyboard is never left nowhere.
 */
export function Sheet({
  id,
  label,
  heading,
  open,
  onClose,
  className,
  children,
}: {
  /** Matched by the opening key's aria-controls, which is where focus returns. */
  id: string;
  label: string;
  heading?: ReactNode;
  open: boolean;
  onClose: () => void;
  /** Over the felt only, or over the whole table. */
  className: "bj__sheet--felt" | "bj__sheet--page";
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement | null>(null);
  /*
   * Read through a ref: an owner passing a fresh function each render would
   * otherwise re-run the effect below, pulling focus back into the sheet and
   * throwing it at the opener on every update the table sends.
   */
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) {
      return;
    }
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.querySelector<HTMLElement>(`[aria-controls="${id}"]`)?.focus();
    };
  }, [open, id]);

  if (!open) {
    return null;
  }

  return (
    <>
      <button type="button" className="bj__scrim" tabIndex={-1} aria-label={`Close ${label}`} onClick={onClose} />
      <div id={id} className={`bj__sheet ${className}`} role="dialog" aria-label={label} ref={panel} tabIndex={-1}>
        <div className="bj__sheet-head">
          <h2 className="bj__sheet-title">{heading ?? label}</h2>
          <button type="button" className="key key--icon" aria-label={`Close ${label}`} onClick={onClose}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="bj__sheet-body table-scroll">{children}</div>
      </div>
    </>
  );
}
