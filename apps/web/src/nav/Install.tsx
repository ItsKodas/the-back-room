import { useState } from "react";
import { useInstall } from "./useInstall.js";

const DISMISSED = "backroom:install-hint-dismissed";

function wasDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED) === "true";
  } catch {
    return false;
  }
}

/**
 * Putting the room on a home screen.
 *
 * Absent unless there is actually something to do: no browser support, or
 * already installed, is nothing on the bar rather than a control that fails.
 * iOS has no prompt to hand over, so there the press opens the two steps
 * instead — on a press, because a phone has no hover to reveal it with.
 */
export function Install() {
  const offer = useInstall();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(wasDismissed);

  if (offer.kind === "prompt") {
    return (
      <button type="button" className="btn btn--ghost btn--small" onClick={offer.install}>
        Install
      </button>
    );
  }
  if (offer.kind === "none" || dismissed) {
    return null;
  }
  return (
    <span className="install">
      <button
        type="button"
        className="btn btn--ghost btn--small"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        Install
      </button>
      {open ? (
        <span className="install__hint" role="dialog" aria-label="Install The Back Room">
          <span>
            Tap <ShareIcon /> <b>Share</b>, then <b>Add to Home Screen</b>.
          </span>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => {
              try {
                window.localStorage.setItem(DISMISSED, "true");
              } catch {
                // Private mode: it goes for this visit, which is still an answer.
              }
              setDismissed(true);
            }}
          >
            Got it
          </button>
        </span>
      ) : null}
    </span>
  );
}

/** Apple's share glyph, so the instruction matches what is on the screen. */
function ShareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v12" />
      <polyline points="8 7 12 3 16 7" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  );
}
