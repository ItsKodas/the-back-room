import { useState } from "react";
import { useInstall } from "./useInstall.js";

/**
 * Putting the room on a home screen.
 *
 * On the bar in every browser tab and gone only inside the installed app,
 * so it is always somewhere to find again. An icon rather than a word, like
 * the rest of what the bar operates.
 *
 * Where the browser has a prompt to hand over, the press is that prompt.
 * Everywhere else it opens the steps: iOS has no prompt at all, and plenty of
 * browsers only offer installing from their own menu. On a press, because a
 * phone has no hover to reveal anything with.
 */
export function Install() {
  const offer = useInstall();
  const [open, setOpen] = useState(false);

  if (offer.kind === "installed") {
    return null;
  }
  const explains = offer.kind !== "prompt";

  return (
    <span className="install">
      <button
        type="button"
        className="iconbtn"
        aria-label="Install The Back Room"
        title="Install The Back Room"
        aria-expanded={explains ? open : undefined}
        onClick={explains ? () => setOpen((was) => !was) : offer.install}
      >
        <DownloadIcon />
      </button>
      {explains && open ? (
        <span className="install__hint" role="dialog" aria-label="How to install The Back Room">
          {offer.kind === "ios" ? (
            <span>
              Tap <ShareIcon /> <b>Share</b>, then <b>Add to Home Screen</b>.
            </span>
          ) : (
            <span>
              Open your browser's menu and choose <b>Install app</b> or <b>Add to Home Screen</b>.
            </span>
          )}
          <button type="button" className="btn btn--ghost btn--small" onClick={() => setOpen(false)}>
            Got it
          </button>
        </span>
      ) : null}
    </span>
  );
}

function DownloadIcon() {
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
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
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
