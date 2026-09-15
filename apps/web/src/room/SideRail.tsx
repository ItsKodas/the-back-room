import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { play } from "../game/audio.js";

/**
 * A column beside the room, or a drawer off its edge when there is no room.
 *
 * One element for both, and CSS rather than script decides which it is: a
 * width read in JavaScript is a width that is wrong for a frame after every
 * rotate, and the drawer's hidden state is `visibility`, which takes it out
 * of the tab order and the accessibility tree on a phone without needing to
 * know it is on one. The tab that opens it is never shown when the column is,
 * so `open` means nothing at a width where there is no drawer.
 */
export function SideRail({
  side,
  label,
  icon,
  children,
}: {
  side: "left" | "right";
  label: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const tab = useRef<HTMLButtonElement>(null);
  const shut = useRef<HTMLButtonElement>(null);
  // Only hand focus back after a close somebody asked for, not on first paint.
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) {
      shut.current?.focus();
    } else if (wasOpen.current) {
      tab.current?.focus();
    }
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function show() {
    play("open");
    setOpen(true);
  }

  function close() {
    play("close");
    setOpen(false);
  }

  return (
    <>
      <button
        ref={tab}
        type="button"
        className={`rail__tab rail__tab--${side}`}
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={show}
      >
        {icon}
      </button>
      {/* Behind the drawer, so a tap anywhere else puts it away. Not a
          keyboard stop: Escape and the drawer's own close do that job. */}
      <button
        type="button"
        className="rail__scrim"
        data-open={open || undefined}
        tabIndex={-1}
        aria-hidden="true"
        onClick={close}
      />
      <aside id={id} className={`rail rail--${side}`} data-open={open || undefined} aria-label={label}>
        <button ref={shut} type="button" className="rail__close" aria-label={`Close ${label.toLowerCase()}`} onClick={close}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        {children}
      </aside>
    </>
  );
}
