import type { MutableRefObject } from "react";
import { useEffect, useRef } from "react";

/**
 * How anything laid over a table is dismissed: Escape shuts it, and focus goes
 * back to the key that opened it.
 *
 * One hook rather than one implementation per sheet. Roulette's stage carries
 * two panels on the same rectangle — table talk and what it pays — and two
 * panels that shut differently is a defect a player meets as "the other one
 * didn't", with the keyboard one left standing on nothing. Written once, they
 * cannot drift.
 *
 * The scrim stays the caller's, because only the caller knows what its sheet
 * covers and therefore where the rest of the table is. What may not vary is
 * this: Escape works, and a keyboard is never left nowhere.
 *
 * `onClose` is read through a ref. An owner passing a fresh arrow every render
 * — which is the ordinary way to write `() => setOpen(false)` — would
 * otherwise re-run the effect on every update the table sends, dragging focus
 * back into the panel each time and throwing it at the opener on the way out.
 *
 * @param id The sheet's own id, which its key names in `aria-controls`: that
 *   is how focus finds its way home without the key and the sheet having to
 *   know about each other.
 */
export function useSheetDismiss({
  open,
  onClose,
  id,
}: {
  open: boolean;
  onClose: () => void;
  id: string;
}): MutableRefObject<HTMLDivElement | null> {
  const panel = useRef<HTMLDivElement | null>(null);
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

  return panel;
}
